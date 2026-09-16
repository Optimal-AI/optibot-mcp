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
    getRelatedFileContents,
    readDiagnosticsFile,
    getRemoteBranches,
    detectBaseBranch,
    checkMergeConflicts,
    assertSafeRefName,
    createUploadBudget,
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
        mockExecFile('/Users/me/project\n');
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
        mockExecFile('/Users/me/my-project\n');
        const name = await getRepoName();
        expect(name).toBe('my-project');
    });
});

describe('getDiffHead', () => {
    it('returns stdout from git diff HEAD', async () => {
        mockExecFile('diff --git a/file.ts b/file.ts\n');
        const diff = await getDiffHead('/repo');
        expect(diff).toBe('diff --git a/file.ts b/file.ts\n');
    });

    it('calls execFile with correct cwd and maxBuffer', async () => {
        mockExecFile('');
        await getDiffHead('/repo');
        expect(execFileMock).toHaveBeenCalledWith(
            'git',
            ['diff', 'HEAD'],
            expect.objectContaining({
                cwd: '/repo',
                maxBuffer: 50 * 1024 * 1024,
            }),
            expect.any(Function)
        );
    });
});

describe('getDiffBranch', () => {
    it('calls git diff with --end-of-options before the target branch', async () => {
        mockExecFile('branch diff output');
        const diff = await getDiffBranch('main', '/repo');
        expect(diff).toBe('branch diff output');
        expect(execFileMock).toHaveBeenCalledWith(
            'git',
            ['diff', '--end-of-options', 'main'],
            expect.objectContaining({ cwd: '/repo' }),
            expect.any(Function)
        );
    });

    it('rejects branch names that look like git options', async () => {
        await expect(getDiffBranch('--upload-pack=evil', '/repo')).rejects.toThrow('Invalid branch name');
        await expect(getDiffBranch('-e foo', '/repo')).rejects.toThrow('Invalid branch name');
    });

    it('rejects branch names containing shell metacharacters', async () => {
        await expect(getDiffBranch('main;rm -rf /', '/repo')).rejects.toThrow('Invalid branch name');
        await expect(getDiffBranch('main$(whoami)', '/repo')).rejects.toThrow('Invalid branch name');
    });
});

describe('assertSafeRefName', () => {
    it('accepts ordinary branch names', () => {
        expect(() => assertSafeRefName('main')).not.toThrow();
        expect(() => assertSafeRefName('origin/main')).not.toThrow();
        expect(() => assertSafeRefName('feature/foo-bar')).not.toThrow();
        expect(() => assertSafeRefName('release-1.3.0')).not.toThrow();
        expect(() => assertSafeRefName('user@/my+ref')).not.toThrow();
    });

    it('rejects empty or non-string input', () => {
        expect(() => assertSafeRefName('')).toThrow('non-empty string');
        expect(() => assertSafeRefName(undefined as unknown as string)).toThrow('non-empty string');
    });

    it('rejects leading dash (option-injection)', () => {
        expect(() => assertSafeRefName('-rm')).toThrow('must not start with "-"');
        expect(() => assertSafeRefName('--upload-pack=evil')).toThrow('must not start with "-"');
    });

    it('rejects path-traversal sequences', () => {
        expect(() => assertSafeRefName('a/../b')).toThrow('forbidden sequence');
        expect(() => assertSafeRefName('a//b')).toThrow('forbidden sequence');
        expect(() => assertSafeRefName('/main')).toThrow('forbidden sequence');
        expect(() => assertSafeRefName('main/')).toThrow('forbidden sequence');
    });

    it('rejects shell-special and control characters', () => {
        expect(() => assertSafeRefName('main;rm')).toThrow('forbidden characters');
        expect(() => assertSafeRefName('main$(x)')).toThrow('forbidden characters');
        expect(() => assertSafeRefName('main`x`')).toThrow('forbidden characters');
        expect(() => assertSafeRefName('main x')).toThrow('forbidden characters');
        expect(() => assertSafeRefName('main\nfoo')).toThrow('forbidden characters');
        expect(() => assertSafeRefName('main\x00')).toThrow('forbidden characters');
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
            'diff --name-status HEAD': 'M\tsrc/file1.ts\nA\tsrc/file2.ts\nD\tsrc/file3.ts\n',
            'ls-files --others': '',
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
            'diff --name-status HEAD': 'M\tb.ts\n',
            'ls-files --others': '',
        });

        const files = await getChangedFiles('/repo', 'main');
        const paths = files.map(f => f.relativePath);
        expect(paths).toContain('a.ts');
        expect(paths).toContain('b.ts');
    });

    it('includes untracked files with status "?"', async () => {
        mockExecPerCommand({
            'diff --name-status HEAD': '',
            'ls-files --others': 'new-file.ts\n',
        });

        const files = await getChangedFiles('/repo');
        expect(files).toHaveLength(1);
        expect(files[0]).toEqual({ relativePath: 'new-file.ts', status: '?' });
    });

    it('handles empty output', async () => {
        mockExecPerCommand({
            'diff --name-status HEAD': '',
            'ls-files --others': '',
        });

        const files = await getChangedFiles('/repo');
        expect(files).toEqual([]);
    });

    it('rejects unsafe target branch names before invoking git', async () => {
        await expect(getChangedFiles('/repo', '--exec=evil')).rejects.toThrow('Invalid branch name');
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

describe('getRelatedFileContents', () => {
    beforeEach(() => {
        vi.mocked(fs.readFile).mockReset();
        // Containment resolves both the root and the candidate through
        // realpath. Default to a lexical resolution so the tests behave like
        // paths with no symlinks; the symlink test overrides this.
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) => path.resolve(String(p))) as never);
    });

    it('reads each related path and keys contents by repo-relative path', async () => {
        vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
            if (String(p).endsWith('caller.ts')) return 'caller source';
            if (String(p).endsWith('iface.ts')) return 'interface source';
            throw new Error('unexpected');
        });

        const { contents, warnings } = await getRelatedFileContents(
            ['src/caller.ts', 'src/iface.ts'],
            '/repo'
        );

        expect(contents).toEqual({
            'src/caller.ts': 'caller source',
            'src/iface.ts': 'interface source',
        });
        expect(warnings).toEqual([]);
    });

    it('warns and skips unreadable paths but keeps the readable ones', async () => {
        vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
            if (String(p).endsWith('present.ts')) return 'ok';
            throw new Error('ENOENT');
        });

        const { contents, warnings } = await getRelatedFileContents(
            ['src/present.ts', 'src/missing.ts'],
            '/repo'
        );

        expect(contents).toEqual({ 'src/present.ts': 'ok' });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Could not read related file: src/missing.ts');
    });

    it('warns and skips paths that escape the repo root', async () => {
        const { contents, warnings } = await getRelatedFileContents(
            ['../outside.ts'],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('not a readable file inside the repository');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses an absolute path and a home-relative path', async () => {
        const { contents, warnings } = await getRelatedFileContents(
            ['/etc/passwd', '~/.ssh/id_rsa'],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings).toHaveLength(2);
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a symlink whose target is a sensitive file inside the repo', async () => {
        // Containment passes — the target is inside the repository — so only
        // checking the resolved name stops `.env` being read and uploaded.
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) =>
            String(p).endsWith('notes.md') ? '/repo/.env' : path.resolve(String(p))) as never);

        const { contents, warnings } = await getRelatedFileContents(['notes.md'], '/repo');

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('sensitive');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a symlink whose target is a binary file inside the repo', async () => {
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) =>
            String(p).endsWith('notes.md') ? '/repo/assets/logo.png' : path.resolve(String(p))) as never);

        const { contents, warnings } = await getRelatedFileContents(['notes.md'], '/repo');

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('binary');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a symlink inside the repo whose target escapes it', async () => {
        // The lexical check passes for this path; only realpath exposes that
        // the link resolves outside the repository.
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) =>
            String(p).endsWith('notes.md') ? '/Users/someone/.ssh/id_rsa' : path.resolve(String(p))) as never);

        const { contents, warnings } = await getRelatedFileContents(['notes.md'], '/repo');

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('not a readable file inside the repository');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('warns and skips potentially sensitive related files', async () => {
        const { contents, warnings } = await getRelatedFileContents(
            ['.env'],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('sensitive');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('warns and skips binary related files (by extension)', async () => {
        const { contents, warnings } = await getRelatedFileContents(
            ['assets/logo.png'],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('binary');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('warns and skips related files whose content carries a NUL byte', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('text\u0000more');

        const { contents, warnings } = await getRelatedFileContents(
            ['src/weird.ts'],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings[0]).toContain('binary');
    });

    it('ignores blank path entries', async () => {
        const { contents, warnings } = await getRelatedFileContents(
            ['   ', ''],
            '/repo'
        );

        expect(contents).toEqual({});
        expect(warnings).toEqual([]);
        expect(fs.readFile).not.toHaveBeenCalled();
    });
});

describe('readDiagnosticsFile', () => {
    beforeEach(() => {
        vi.mocked(fs.readFile).mockReset();
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) => path.resolve(String(p))) as never);
        vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as never);
    });

    it('reads a diagnostics file within the repo as plain text', async () => {
        vi.mocked(fs.readFile).mockResolvedValue('tsc: 3 errors');

        const text = await readDiagnosticsFile('build/tsc.log', '/repo');
        expect(text).toBe('tsc: 3 errors');
        expect(fs.readFile).toHaveBeenCalledWith(path.resolve('/repo', 'build/tsc.log'), 'utf-8');
    });

    it('rejects a diagnostics path that escapes the repo root', async () => {
        await expect(readDiagnosticsFile('../../etc/passwd', '/repo')).rejects.toThrow(
            'must be a readable file within the repository'
        );
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('rejects a path carrying a NUL, which would truncate in the read', async () => {
        await expect(readDiagnosticsFile('valid.log\u0000../../etc/passwd', '/repo')).rejects.toThrow(
            'must be a readable file within the repository'
        );
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a symlink inside the repo whose target escapes it', async () => {
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) =>
            String(p).endsWith('tsc.log') ? '/Users/someone/.ssh/id_rsa' : path.resolve(String(p))) as never);

        await expect(readDiagnosticsFile('build/tsc.log', '/repo')).rejects.toThrow(
            'must be a readable file within the repository'
        );
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a symlink whose target is a sensitive file inside the repo', async () => {
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) =>
            String(p).endsWith('tsc.log') ? '/repo/id_rsa' : path.resolve(String(p))) as never);

        await expect(readDiagnosticsFile('build/tsc.log', '/repo')).rejects.toThrow('potentially sensitive');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a sensitive file, which would otherwise be uploaded as text', async () => {
        await expect(readDiagnosticsFile('.env', '/repo')).rejects.toThrow('potentially sensitive');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a binary file', async () => {
        await expect(readDiagnosticsFile('build/output.png', '/repo')).rejects.toThrow('looks binary');
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('refuses a file larger than the upload cap', async () => {
        vi.mocked(fs.stat).mockResolvedValue({ size: 26 * 1024 * 1024 } as never);
        await expect(readDiagnosticsFile('build/tsc.log', '/repo')).rejects.toThrow('too large to send');
        expect(fs.readFile).not.toHaveBeenCalled();
    });
});

describe('getRemoteBranches', () => {
    it('parses git branch -r output', async () => {
        mockExecFile('  origin/main\n  origin/develop\n  origin/feature-x\n');
        const branches = await getRemoteBranches('/repo');
        expect(branches).toEqual(['origin/develop', 'origin/feature-x', 'origin/main']);
    });

    it('filters out HEAD references', async () => {
        mockExecFile('  origin/HEAD -> origin/main\n  origin/main\n  origin/develop\n');
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
        mockExecFile('');
        const branches = await getRemoteBranches('/repo');
        expect(branches).toEqual([]);
    });
});

describe('detectBaseBranch', () => {
    it('returns origin/main when available', async () => {
        mockExecFile('  origin/main\n  origin/develop\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/main');
    });

    it('returns origin/master when main is not available', async () => {
        mockExecFile('  origin/master\n  origin/develop\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/master');
    });

    it('returns origin/develop when neither main nor master exist', async () => {
        mockExecFile('  origin/develop\n  origin/feature\n');
        const branch = await detectBaseBranch('/repo');
        expect(branch).toBe('origin/develop');
    });

    it('returns first branch when no standard branches found', async () => {
        mockExecFile('  origin/feature-a\n  origin/feature-b\n');
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

    it('rejects unsafe target branch names before invoking git', async () => {
        await expect(checkMergeConflicts('--exec=evil', '/repo')).rejects.toThrow('Invalid branch name');
    });
});

describe('createUploadBudget', () => {
    it('spends against one cap across several calls', () => {
        const budget = createUploadBudget(100);
        expect(budget.canFit(60)).toBe(true);
        budget.spend(60);
        expect(budget.remaining()).toBe(40);
        expect(budget.canFit(60)).toBe(false);
        expect(budget.canFit(40)).toBe(true);
    });

    it('holds the total when the changed files and the related files share it', async () => {
        // The point of the shared budget: separately, each read could take the
        // whole cap, so one request carried twice it.
        const budget = createUploadBudget(10);
        vi.mocked(fs.realpath).mockImplementation((async (p: unknown) => path.resolve(String(p))) as never);
        vi.mocked(fs.lstat).mockResolvedValue({ isSymbolicLink: () => false } as never);
        vi.mocked(fs.readFile).mockResolvedValue('0123456789');

        mockExecFile('');
        const first = await getRelatedFileContents(['a.ts'], '/repo', budget);
        const second = await getRelatedFileContents(['b.ts'], '/repo', budget);

        expect(Object.keys(first.contents)).toEqual(['a.ts']);
        expect(Object.keys(second.contents)).toEqual([]);
        expect(second.warnings.join(' ')).toContain('upload');
    });
});
