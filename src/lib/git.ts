import { exec as execCb, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitChangedFile } from '../types.js';

const exec = promisify(execCb);
const execFile = promisify(execFileCb);

const BINARY_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.app',
    '.class', '.pyc', '.o', '.a', '.lib',
    '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.db', '.sqlite', '.sqlite3',
    '.jar', '.war', '.ear', '.deb', '.rpm',
];

export async function getRepoRoot(): Promise<string> {
    try {
        const { stdout } = await exec('git rev-parse --show-toplevel');
        return stdout.trim();
    } catch {
        throw new Error('Not a git repository (or git is not installed)');
    }
}

export async function getRepoName(): Promise<string> {
    const root = await getRepoRoot();
    return path.basename(root);
}

export async function getDiffHead(repoRoot: string): Promise<string> {
    const { stdout } = await exec('git diff HEAD', {
        cwd: repoRoot,
        maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
}

export async function getDiffBranch(targetBranch: string, repoRoot: string): Promise<string> {
    const { stdout } = await execFile('git', ['diff', targetBranch], {
        cwd: repoRoot,
        maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
}

export async function readDiffFile(filePath: string): Promise<string> {
    const resolvedPath = path.resolve(filePath);
    const cwd = process.cwd();

    // Prevent reading files outside the current working directory
    if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
        throw new Error(`Diff file must be within the current directory. Got: ${filePath}`);
    }

    return fs.readFile(resolvedPath, 'utf-8');
}

export async function getChangedFiles(repoRoot: string, targetBranch?: string): Promise<GitChangedFile[]> {
    const changesMap = new Map<string, GitChangedFile>();

    if (targetBranch) {
        // Committed changes since divergence
        const { stdout: committedOutput } = await execFile(
            'git', ['diff', '--name-status', `${targetBranch}...HEAD`],
            { cwd: repoRoot }
        );
        parseNameStatus(committedOutput, changesMap);

        // Uncommitted changes (override committed for same file)
        const { stdout: uncommittedOutput } = await exec(
            'git diff --name-status HEAD',
            { cwd: repoRoot }
        );
        parseNameStatus(uncommittedOutput, changesMap);
    } else {
        // Local mode: staged + unstaged vs HEAD
        const { stdout } = await exec('git diff --name-status HEAD', { cwd: repoRoot });
        parseNameStatus(stdout, changesMap);
    }

    // Untracked files
    const { stdout: untrackedOutput } = await exec(
        'git ls-files --others --exclude-standard',
        { cwd: repoRoot }
    );
    for (const line of untrackedOutput.split('\n').filter(l => l.trim())) {
        changesMap.set(line, { relativePath: line, status: '?' });
    }

    return Array.from(changesMap.values());
}

function parseNameStatus(output: string, map: Map<string, GitChangedFile>): void {
    for (const line of output.split('\n').filter(l => l.trim())) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
            const status = parts[0].charAt(0) as GitChangedFile['status'];
            const relativePath = parts[1];
            map.set(relativePath, { relativePath, status });
        }
    }
}

export async function getFileContents(
    changedFiles: GitChangedFile[],
    repoRoot: string
): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};

    for (const file of changedFiles) {
        if (file.status === 'D') continue;

        const absolutePath = path.join(repoRoot, file.relativePath);

        if (await isBinaryFile(absolutePath)) continue;

        try {
            contents[file.relativePath] = await fs.readFile(absolutePath, 'utf-8');
        } catch {
            // Skip files we can't read
        }
    }

    return contents;
}

export async function getRemoteBranches(repoRoot: string): Promise<string[]> {
    try {
        const { stdout } = await exec('git branch -r', { cwd: repoRoot });
        return stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.includes('->'))
            .sort();
    } catch {
        return [];
    }
}

export async function detectBaseBranch(repoRoot: string): Promise<string> {
    const branches = await getRemoteBranches(repoRoot);
    const candidates = ['origin/main', 'origin/master', 'origin/develop'];

    for (const candidate of candidates) {
        if (branches.includes(candidate)) return candidate;
    }

    return branches[0] || 'origin/main';
}

export async function checkMergeConflicts(targetBranch: string, repoRoot: string): Promise<boolean> {
    try {
        // Use git merge-tree (Git 2.38+) for non-destructive conflict check
        const { stdout } = await execFile(
            'git', ['merge-tree', '--write-tree', 'HEAD', targetBranch],
            { cwd: repoRoot }
        );
        return stdout.includes('<<<<<<<') || stdout.includes('=======') || stdout.includes('>>>>>>>');
    } catch (err: any) {
        // git merge-tree exits with non-zero when there are conflicts
        const output = err?.stderr || err?.stdout || '';
        if (output.includes('CONFLICT') || output.includes('<<<<<<<')) {
            return true;
        }

        // Fallback: check for overlapping file changes
        try {
            const { stdout: mergeBase } = await execFile(
                'git', ['merge-base', 'HEAD', targetBranch],
                { cwd: repoRoot }
            );
            const base = mergeBase.trim();

            const { stdout: ourChanges } = await execFile(
                'git', ['diff', '--name-only', `${base}...HEAD`],
                { cwd: repoRoot }
            );

            const { stdout: theirChanges } = await execFile(
                'git', ['diff', '--name-only', `${base}...${targetBranch}`],
                { cwd: repoRoot }
            );

            const ourFiles = new Set(ourChanges.split('\n').filter(f => f.trim()));
            const theirFiles = theirChanges.split('\n').filter(f => f.trim());

            return theirFiles.some(f => ourFiles.has(f));
        } catch {
            return false; // Safe default: don't block the review
        }
    }
}

function isBinaryExtension(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return BINARY_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function isBinaryContent(filePath: string): Promise<boolean> {
    try {
        const handle = await fs.open(filePath, 'r');
        try {
            const buf = Buffer.alloc(8192);
            const { bytesRead } = await handle.read(buf, 0, 8192, 0);
            if (bytesRead === 0) return false;

            const chunk = buf.subarray(0, bytesRead);
            if (chunk.includes(0)) return true;

            let nonText = 0;
            for (let i = 0; i < bytesRead; i++) {
                const b = chunk[i];
                if (b < 9 || (b > 13 && b < 32 && b !== 27)) nonText++;
            }
            return nonText / bytesRead > 0.3;
        } finally {
            await handle.close();
        }
    } catch {
        return true;
    }
}

async function isBinaryFile(filePath: string): Promise<boolean> {
    if (isBinaryExtension(filePath)) return true;
    return isBinaryContent(filePath);
}
