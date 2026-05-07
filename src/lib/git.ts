import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitChangedFile } from '../types.js';

const execFile = promisify(execFileCb);

// Patterns for files that may contain secrets — skipped before uploading for review
const SENSITIVE_FILENAME_PATTERNS: RegExp[] = [
    /^\.env(\.|$)/i,           // .env, .env.local, .env.production, etc.
    /\.pem$/i,                 // TLS/SSH private keys
    /\.key$/i,                 // Generic key files
    /\.p12$/i,                 // PKCS#12 keystores
    /\.pfx$/i,                 // Personal Information Exchange
    /\.cer$/i,                 // Certificates
    /\.crt$/i,                 // Certificates
    /id_rsa(\.pub)?$/i,        // SSH keys
    /id_ed25519(\.pub)?$/i,    // SSH keys
    /id_dsa(\.pub)?$/i,        // SSH keys
    /id_ecdsa(\.pub)?$/i,      // SSH keys
    /\.secret$/i,              // Generic secret files
    /credentials(\.json)?$/i,  // AWS/GCP credentials
    /secrets(\.json|\.yaml|\.yml)?$/i, // Generic secrets
    /service.?account.*\.json$/i,      // GCP service accounts
    /\.npmrc$/i,               // npm auth tokens
    /\.pypirc$/i,              // PyPI credentials
    /\.netrc$/i,               // Generic credentials
    /authinfo(\.gpg)?$/i,      // Emacs auth info
];

export function isSensitiveFile(relativePath: string): boolean {
    const basename = path.basename(relativePath);
    return SENSITIVE_FILENAME_PATTERNS.some(pattern => pattern.test(basename));
}

/**
 * Reject ref names that could be mistaken for git CLI options or contain
 * shell-meaningful characters. `execFile` blocks shell injection, but a ref
 * starting with `-` (or containing a colon, space, or path-traversal
 * sequence) can still be parsed by git as an option or coerced into
 * unintended behavior. Combined with `--end-of-options` at each call site
 * this is defense in depth.
 *
 * Rules drawn from `git check-ref-format` (a strict permissive subset):
 *   - non-empty, doesn't start with `-`
 *   - no whitespace, no NUL, no shell metas (`;`, `|`, `&`, `$`, backtick, etc.)
 *   - no `..` (revision range syntax is built explicitly elsewhere)
 *   - no leading or trailing slash, no `//`
 */
export function assertSafeRefName(ref: string): void {
    if (typeof ref !== 'string' || ref.length === 0) {
        throw new Error('Invalid branch name: must be a non-empty string');
    }
    if (ref.startsWith('-')) {
        throw new Error(`Invalid branch name: must not start with "-" (got: ${ref})`);
    }
    if (ref.includes('..') || ref.includes('//') || ref.startsWith('/') || ref.endsWith('/')) {
        throw new Error(`Invalid branch name: contains a forbidden sequence (got: ${ref})`);
    }
    // Whitelist: letters, digits, and the punctuation git refs commonly use.
    // Excludes shell metas, NUL, whitespace, control chars, and `:`/`?`/`*`/`[`
    // which git itself disallows.
    if (!/^[A-Za-z0-9._/+@~\-]+$/.test(ref)) {
        throw new Error(`Invalid branch name: contains forbidden characters (got: ${ref})`);
    }
}

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
        const { stdout } = await execFile('git', ['rev-parse', '--show-toplevel']);
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
    const { stdout } = await execFile('git', ['diff', 'HEAD'], {
        cwd: repoRoot,
        maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
}

export async function getDiffBranch(targetBranch: string, repoRoot: string): Promise<string> {
    assertSafeRefName(targetBranch);
    const { stdout } = await execFile('git', ['diff', '--end-of-options', targetBranch], {
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
        assertSafeRefName(targetBranch);
        // Committed changes since divergence
        const { stdout: committedOutput } = await execFile(
            'git', ['diff', '--name-status', '--end-of-options', `${targetBranch}...HEAD`],
            { cwd: repoRoot }
        );
        parseNameStatus(committedOutput, changesMap);

        // Uncommitted changes (override committed for same file)
        const { stdout: uncommittedOutput } = await execFile(
            'git', ['diff', '--name-status', 'HEAD'],
            { cwd: repoRoot }
        );
        parseNameStatus(uncommittedOutput, changesMap);
    } else {
        // Local mode: staged + unstaged vs HEAD
        const { stdout } = await execFile('git', ['diff', '--name-status', 'HEAD'], { cwd: repoRoot });
        parseNameStatus(stdout, changesMap);
    }

    // Untracked files
    const { stdout: untrackedOutput } = await execFile(
        'git', ['ls-files', '--others', '--exclude-standard'],
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

// Soft cap on the total size of file contents we'll upload alongside a diff.
// Stops a poorly-scoped repo (vendored bundles, large fixtures) from sending
// hundreds of MB across the wire before the backend rejects.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function getFileContents(
    changedFiles: GitChangedFile[],
    repoRoot: string
): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};
    let totalBytes = 0;
    let truncated = 0;

    for (const file of changedFiles) {
        if (file.status === 'D') continue;

        if (isSensitiveFile(file.relativePath)) {
            console.error(`[security] Skipping potentially sensitive file: ${file.relativePath}`);
            continue;
        }

        const absolutePath = path.join(repoRoot, file.relativePath);

        if (await isBinaryFile(absolutePath)) continue;

        try {
            const content = await fs.readFile(absolutePath, 'utf-8');
            const size = Buffer.byteLength(content, 'utf-8');
            if (totalBytes + size > MAX_UPLOAD_BYTES) {
                truncated += 1;
                continue;
            }
            contents[file.relativePath] = content;
            totalBytes += size;
        } catch {
            // Skip files we can't read
        }
    }

    if (truncated > 0) {
        console.error(`[upload] Skipped ${truncated} file(s) — total upload would exceed ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
    }

    return contents;
}

export async function getRemoteBranches(repoRoot: string): Promise<string[]> {
    try {
        const { stdout } = await execFile('git', ['branch', '-r'], { cwd: repoRoot });
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
    assertSafeRefName(targetBranch);
    try {
        // Use git merge-tree (Git 2.38+) for non-destructive conflict check
        const { stdout } = await execFile(
            'git', ['merge-tree', '--write-tree', '--end-of-options', 'HEAD', targetBranch],
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
                'git', ['merge-base', '--end-of-options', 'HEAD', targetBranch],
                { cwd: repoRoot }
            );
            const base = mergeBase.trim();

            const { stdout: ourChanges } = await execFile(
                'git', ['diff', '--name-only', '--end-of-options', `${base}...HEAD`],
                { cwd: repoRoot }
            );

            const { stdout: theirChanges } = await execFile(
                'git', ['diff', '--name-only', '--end-of-options', `${base}...${targetBranch}`],
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
