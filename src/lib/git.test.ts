import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

vi.mock('child_process', () => {
    const execMock = vi.fn();
    const execFileMock = vi.fn();
    return { exec: execMock, execFile: execFileMock };
});

vi.mock('fs/promises');

import { exec, execFile } from 'child_process';
import * as fs from 'fs/promises';
import {
    getRepoRoot,
    getRepoName,
    getDiffHead,
    getDiffBranch,
    readDiffFile,
    getChangedFiles,
    getFileContents,
    getRemoteBranches,
    detectBaseBranch,
    checkMergeConflicts,
} from './git.js';

const execMock = vi.mocked(exec);
const execFileMock = vi.mocked(execFile);

function mockExec(stdout: string, stderr = '') {
    execMock.mockImplementation(((
        _cmd: string,
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        callback!(null, { stdout, stderr });
    }) as any);
}

function mockExecFile(stdout: string, stderr = '') {
    execFileMock.mockImplementation(((
        _file: string,
        _args: any,
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        callback!(null, { stdout, stderr });
    }) as any);
}

function mockAll(stdout: string, stderr = '') {
    mockExec(stdout, stderr);
    mockExecFile(stdout, stderr);
}

function mockExecPerCommand(responses: Record<string, string>) {
    execMock.mockImplementation(((
        cmd: string,
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        for (const [pattern, stdout] of Object.entries(responses)) {
            if (cmd.includes(pattern)) {
                callback!(null, { stdout, stderr: '' });
                return;
            }
        }
        callback!(null, { stdout: '', stderr: '' });
    }) as any);

    execFileMock.mockImplementation(((
        _file: string,
        args: string[],
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        const joined = args?.join(' ') || '';
        for (const [pattern, stdout] of Object.entries(responses)) {
            if (joined.includes(pattern)) {
                callback!(null, { stdout, stderr: '' });
                return;
            }
        }
        callback!(null, { stdout: '', stderr: '' });
    }) as any);
}

function mockExecError(message: string) {
    execMock.mockImplementation(((
        _cmd: string,
        _opts: any,
        cb?: (err: Error | null, result: any) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        callback!(new Error(message), null);
    }) as any);

    execFileMock.mockImplementation(((
        _file: string,
        _args: any,
        _opts: any,
        cb?: (err: Error | null, result: any) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        callback!(new Error(message), null);
    }) as any);
}

function mockExecPerCommandWithErrors(
    responses: Record<string, string>,
    errors: Record<string, { message: string; stderr?: string; stdout?: string }>
) {
    execMock.mockImplementation(((
        cmd: string,
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string } | null) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        for (const [pattern, errInfo] of Object.entries(errors)) {
            if (cmd.includes(pattern)) {
                const err: any = new Error(errInfo.message);
                err.stderr = errInfo.stderr || '';
                err.stdout = errInfo.stdout || '';
                callback!(err, null);
                return;
            }
        }
        for (const [pattern, stdout] of Object.entries(responses)) {
            if (cmd.includes(pattern)) {
                callback!(null, { stdout, stderr: '' });
                return;
            }
        }
        callback!(null, { stdout: '', stderr: '' });
    }) as any);

    execFileMock.mockImplementation(((
        _file: string,
        args: string[],
        _opts: any,
        cb?: (err: Error | null, result: { stdout: string; stderr: string } | null) => void
    ) => {
        const callback = typeof _opts === 'function' ? _opts : cb;
        const joined = args?.join(' ') || '';
        for (const [pattern, errInfo] of Object.entries(errors)) {
            if (joined.includes(pattern)) {
                const err: any = new Error(errInfo.message);
                err.stderr = errInfo.stderr || '';
                err.stdout = errInfo.stdout || '';
                callback!(err, null);
                return;
            }
        }
        for (const [pattern, stdout] of Object.entries(responses)) {
            if (joined.includes(pattern)) {
                callback!(null, { stdout, stderr: '' });
                return;
            }
        }
        callback!(null, { stdout: '', stderr: '' });
    }) as any);
}

describe('getRepoRoot', () => {
    it('returns trimmed stdout from git rev-parse', async () => {
        mockExec('/Users/me/project\n');
        const root = await getRepoRoot();
        expect(root).toBe('/Users/me/project');
    });

    it('throws when not in a git repository', async () => {
        mockExecError('not a git repo');
        await expect(getRepoRoot()).rejects.toThrow('Not a git repository');
    });
});

describe('getRepoName', () => {
    it('returns basename of the repo root', async () => {
        mockExec('/Users/me/my-project\n');
        const name = await getRepoName();
        expect(name).toBe('my-project');
    });
});

describe('getDiffHead', () => {
    it('returns stdout from git diff HEAD', async () => {
        mockExec('diff --git a/file.ts b/file.ts\n');
        const diff = await getDiffHead('/repo');
        expect(diff).toBe('diff --git a/file.ts b/file.ts\n');
    });

    it('calls exec with correct cwd and maxBuffer', async () => {
        mockExec('');
        await getDiffHead('/repo');
        expect(execMock).toHaveBeenCalledWith(
            'git diff HEAD',
            expect.objectContaining({
                cwd: '/repo',
                maxBuffer: 50 * 1024 * 1024,
            }),
            expect.any(Function)
        );
    });
});

describe('getDiffBranch', () => {
    it('calls git diff with the target branch via execFile', async () => {
        mockExecFile('branch diff output');
        const diff = await getDiffBranch('main', '/repo');
        expect(diff).toBe('branch diff output');
        expect(execFileMock).toHaveBeenCalledWith(
            'git',
            ['diff', 'main'],
            expect.objectContaining({ cwd: '/repo' }),
            expect.any(Function)
        );
    });
});

describe('readDiffFile', () => {
    it('reads file within the current directory', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('diff content');
        const filePath = path.join(process.cwd(), 'changes.diff');
        const result = await readDiffFile(filePath);
        expect(result).toBe('diff content');
        expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
    });

    it('reads file with relative path within cwd', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('diff content');
        const result = await readDiffFile('changes.diff');
        expect(result).toBe('diff content');
    });

    it('rejects paths outside the current directory', async () => {
        await expect(readDiffFile('/etc/passwd')).rejects.toThrow('Diff file must be within the current directory');
    });

    it('rejects directory traversal attempts', async () => {
        await expect(readDiffFile('../../etc/passwd')).rejects.toThrow('Diff file must be within the current directory');
    });
});

describe('getChangedFiles', () => {
    it('parses git diff --name-status in local mode', async () => {
        mockExecPerCommand({
            'git diff --name-status HEAD': 'M\tsrc/file1.ts\nA\tsrc/file2.ts\nD\tsrc/file3.ts\n',
            'git ls-files --others': '',
        });

        const files = await getChangedFiles('/repo');
        expect(files).toHaveLength(3);
        expect(files[0]).toEqual({ relativePath: 'src/file1.ts', status: 'M' });
        expect(files[1]).toEqual({ relativePath: 'src/file2.ts', status: 'A' });
        expect(files[2]).toEqual({ relativePath: 'src/file3.ts', status: 'D' });
    });

    it('merges committed and uncommitted changes in branch mode', async () => {
        mockExecPerCommand({
            'main...HEAD': 'M\ta.ts\n',
            'git diff --name-status HEAD': 'M\tb.ts\n',
            'git ls-files --others': '',
        });

        const files = await getChangedFiles('/repo', 'main');
        const paths = files.map(f => f.relativePath);
        expect(paths).toContain('a.ts');
        expect(paths).toContain('b.ts');
    });

    it('includes untracked files with status "?"', async () => {
        mockExecPerCommand({
            'git diff --name-status HEAD': '',
            'git ls-files --others': 'new-file.ts\n',
        });

        const files = await getChangedFiles('/repo');
        expect(files).toHaveLength(1);
        expect(files[0]).toEqual({ relativePath: 'new-file.ts', status: '?' });
    });

    it('handles empty output', async () => {
        mockExecPerCommand({
            'git diff --name-status HEAD': '',
            'git ls-files --others': '',
        });

        const files = await getChangedFiles('/repo');
        expect(files).toEqual([]);
    });
});

describe('getFileContents', () => {
    it('reads contents for modified files', async () => {
        const mockHandle = {
            read: vi.fn(async (buf: Buffer) => {
                const data = Buffer.from('hello');
                data.copy(buf, 0);
                return { bytesRead: data.length, buffer: buf };
            }),
            close: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(fs.open).mockResolvedValue(mockHandle as any);
        vi.mocked(fs.readFile).mockResolvedValue('file content');

        const result = await getFileContents(
            [{ relativePath: 'a.ts', status: 'M' }],
            '/repo'
        );
        expect(result['a.ts']).toBe('file content');
    });

    it('skips deleted files', async () => {
        const result = await getFileContents(
            [{ relativePath: 'deleted.ts', status: 'D' }],
            '/repo'
        );
        expect(result).toEqual({});
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('skips binary files detected by extension', async () => {
        const result = await getFileContents(
            [{ relativePath: 'image.png', status: 'A' }],
            '/repo'
        );
        expect(result).toEqual({});
    });

    it('skips binary files detected by content (null bytes)', async () => {
        const mockHandle = {
            read: vi.fn(async (buf: Buffer) => {
                buf.fill(0, 0, 100);
                return { bytesRead: 100, buffer: buf };
            }),
            close: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(fs.open).mockResolvedValue(mockHandle as any);

        const result = await getFileContents(
            [{ relativePath: 'data.dat', status: 'A' }],
            '/repo'
        );
        expect(result).toEqual({});
    });
});

describe('getRemoteBranches', () => {
    it('parses git branch -r output', async () => {
        mockExec('  origin/main\n  origin/develop\n  origin/feature-x\n');
        const branches = await getRemoteBranches('/repo');
        expect(branches).toEqual(['origin/develop', 'origin/feature-x', 'origin/main']);
    });

    it('filters out HEAD references', async () => {
        mockExec('  origin/HEAD -> origin/main\n  origin/main\n  origin/develop\n');
        const branches = await getRemoteBranches('/repo');
        expect(branches).not.toContain('origin/HEAD -> origin/main');
        expect(branches).toContain('origin/main');
    });

    it('returns empty array on error', async () => {
        mockExecError('git failed');
        const branches = await getRemoteBranches('/repo');
        expect(branches).toEqual([]);
    });

    it('returns empty array for empty output', async () => {
        mockExec('');
        const branches = await getRemoteBranches('/repo');
        expect(branches).toEqual([]);
    });
});

describe('detectBaseBranch', () => {
    it('returns origin/main when available', async () => {
        mockExec('  origin/main\n  origin/develop\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/main');
    });

    it('returns origin/master when main is not available', async () => {
        mockExec('  origin/master\n  origin/develop\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/master');
    });

    it('returns origin/develop when neither main nor master exist', async () => {
        mockExec('  origin/develop\n  origin/feature\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/develop');
    });

    it('returns first branch when no standard branches found', async () => {
        mockExec('  origin/feature-a\n  origin/feature-b\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/feature-a');
    });

    it('returns origin/main as fallback when no remote branches exist', async () => {
        mockExecError('no remotes');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/main');
    });
});

describe('checkMergeConflicts', () => {
    it('returns false when merge-tree succeeds with clean output', async () => {
        mockAll('abc123def\n');
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(false);
    });

    it('returns true when merge-tree output contains conflict markers', async () => {
        mockAll('abc123\n<<<<<<< HEAD\nour changes\n=======\ntheir changes\n>>>>>>>\n');
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(true);
    });

    it('returns true when merge-tree fails with CONFLICT in stderr', async () => {
        mockExecPerCommandWithErrors(
            {},
            { 'merge-tree': { message: 'conflict', stderr: 'CONFLICT (content): Merge conflict in file.ts' } }
        );
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(true);
    });

    it('falls back to overlapping file check when merge-tree fails without conflict info', async () => {
        mockExecPerCommandWithErrors(
            {
                'merge-base': 'base-sha\n',
                'base-sha...HEAD': 'shared.ts\nours-only.ts\n',
                'base-sha...origin/main': 'shared.ts\ntheirs-only.ts\n',
            },
            { 'merge-tree': { message: 'unknown error' } }
        );
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(true);
    });

    it('returns false in fallback when no overlapping files', async () => {
        mockExecPerCommandWithErrors(
            {
                'merge-base': 'base-sha\n',
                'base-sha...HEAD': 'ours-only.ts\n',
                'base-sha...origin/main': 'theirs-only.ts\n',
            },
            { 'merge-tree': { message: 'unknown error' } }
        );
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(false);
    });

    it('returns false when all checks fail', async () => {
        mockExecError('everything fails');
        const result = await checkMergeConflicts('origin/main', '/repo');
        expect(result).toBe(false);
    });
});
