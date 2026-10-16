import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
    getChangedFiles,
    getDiffHead,
    getFileContents,
    UNTRACKED_DIFF_MAX_FILE_BYTES,
    UNTRACKED_DIFF_MAX_FILES,
    UNTRACKED_DIFF_MAX_TOTAL_BYTES,
} from './git.js';

const HAS_GIT = (() => {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

// getDiffHead adds untracked files to `git diff HEAD`. git.test.ts mocks
// child_process, so this file checks the real output of `git diff --no-index`
// in a throwaway repository.
describe.skipIf(!HAS_GIT)('getDiffHead with untracked files', () => {
    let repo: string;

    beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-untracked-'));
        const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
        git('init', '-q');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        fs.writeFileSync(path.join(repo, '.gitignore'), '*.local\n');
        fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export const a = 1;\n');
        git('add', '.');
        git('commit', '-q', '-m', 'base');

        fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export const a = 2;\n');
        fs.mkdirSync(path.join(repo, 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export const b = 1;\n');
        fs.writeFileSync(path.join(repo, 'settings.local'), 'ignored\n');
        fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
        fs.writeFileSync(path.join(repo, 'empty.ts'), '');
        // A placeholder private key header, which the content check matches.
        fs.writeFileSync(path.join(repo, 'notes.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n');
    });

    afterAll(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('adds an untracked file as a new file after the tracked changes', async () => {
        const diff = await getDiffHead(repo);
        expect(diff).toContain('diff --git a/tracked.ts b/tracked.ts');
        expect(diff).toContain('+++ b/src/new.ts');
        expect(diff).toContain('+export const b = 1;');
        expect(diff.indexOf('tracked.ts')).toBeLessThan(diff.indexOf('src/new.ts'));
    });

    it('leaves out ignored files and credential files', async () => {
        const diff = await getDiffHead(repo);
        expect(diff).not.toContain('settings.local');
        expect(diff).not.toContain('.env');
    });

    it('leaves out a new file whose content holds a credential', async () => {
        expect(await getDiffHead(repo)).not.toContain('notes.txt');
    });

    it('lists an empty new file as an added file', async () => {
        expect(await getDiffHead(repo)).toContain('diff --git a/empty.ts b/empty.ts');
    });

    it('does not change the index', async () => {
        await getDiffHead(repo);
        const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo }).toString();
        expect(staged).toBe('');
    });

    it('reviews a change made only of new files', async () => {
        const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-untracked-only-'));
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd: fresh });
            git('init', '-q');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'Test');
            fs.writeFileSync(path.join(fresh, 'base.ts'), 'base\n');
            git('add', '.');
            git('commit', '-q', '-m', 'base');
            fs.writeFileSync(path.join(fresh, 'added.ts'), 'export const c = 1;\n');
            expect(await getDiffHead(fresh)).toContain('+++ b/added.ts');
        } finally {
            fs.rmSync(fresh, { recursive: true, force: true });
        }
    });

    describe('limits', () => {
        let limited: string;
        const git = (...args: string[]) => execFileSync('git', args, { cwd: limited });

        beforeAll(() => {
            limited = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-untracked-limits-'));
            git('init', '-q');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'Test');
            fs.writeFileSync(path.join(limited, 'base.ts'), 'base\n');
            git('add', '.');
            git('commit', '-q', '-m', 'base');
        });

        afterAll(() => {
            fs.rmSync(limited, { recursive: true, force: true });
        });

        it('leaves out a file over the per-file limit and keeps the next one', async () => {
            fs.mkdirSync(path.join(limited, 'one'));
            fs.writeFileSync(path.join(limited, 'one', 'a-big.txt'), 'x\n'.repeat(UNTRACKED_DIFF_MAX_FILE_BYTES));
            fs.writeFileSync(path.join(limited, 'one', 'b-small.ts'), 'export const s = 1;\n');
            const diff = await getDiffHead(limited);
            expect(diff).not.toContain('a-big.txt');
            expect(diff).toContain('+++ b/one/b-small.ts');
            fs.rmSync(path.join(limited, 'one'), { recursive: true });
        });

        it('stops adding files at the total limit', async () => {
            fs.mkdirSync(path.join(limited, 'two'));
            const each = UNTRACKED_DIFF_MAX_FILE_BYTES - 2;
            const count = Math.floor(UNTRACKED_DIFF_MAX_TOTAL_BYTES / each) + 1;
            for (let i = 0; i < count; i++) {
                fs.writeFileSync(path.join(limited, 'two', `f${String(i).padStart(2, '0')}.txt`), 'y\n'.repeat(each / 2));
            }
            const diff = await getDiffHead(limited);
            expect(diff).toContain('two/f00.txt');
            expect(diff).not.toContain(`two/f${String(count - 1).padStart(2, '0')}.txt`);
            fs.rmSync(path.join(limited, 'two'), { recursive: true });
        });

        it('adds at most the file-count limit', async () => {
            fs.mkdirSync(path.join(limited, 'three'));
            for (let i = 0; i <= UNTRACKED_DIFF_MAX_FILES; i++) {
                fs.writeFileSync(path.join(limited, 'three', `n${String(i).padStart(4, '0')}.ts`), `export const n = ${i};\n`);
            }
            const diff = await getDiffHead(limited);
            expect(diff.match(/^diff --git /gm)).toHaveLength(UNTRACKED_DIFF_MAX_FILES);
            fs.rmSync(path.join(limited, 'three'), { recursive: true });
        }, 60_000);
    });

    it('leaves out a staged new file whose content holds a credential, and keeps other staged files', async () => {
        const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-staged-'));
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd: staged });
            git('init', '-q');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'Test');
            fs.writeFileSync(path.join(staged, 'base.ts'), 'export const a = 1;\n');
            git('add', '.');
            git('commit', '-q', '-m', 'base');
            // A placeholder private key header, which the content check matches.
            fs.writeFileSync(path.join(staged, 'keys.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n');
            fs.writeFileSync(path.join(staged, 'added.ts'), 'export const c = 3;\n');
            git('add', 'keys.txt', 'added.ts');

            const diff = await getDiffHead(staged);
            expect(diff).toContain('+++ b/added.ts');
            expect(diff).not.toContain('keys.txt');

            const contents = await getFileContents(await getChangedFiles(staged), staged);
            expect(Object.keys(contents)).toEqual(['added.ts']);
        } finally {
            fs.rmSync(staged, { recursive: true, force: true });
        }
    });

    it('does not send a changed file that links to an ignored file', async () => {
        const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-link-'));
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd: linked });
            git('init', '-q');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'Test');
            fs.writeFileSync(path.join(linked, '.gitignore'), '*.local\n');
            git('add', '.');
            git('commit', '-q', '-m', 'base');
            fs.writeFileSync(path.join(linked, 'settings.local'), 'token = placeholder\n');
            fs.symlinkSync('settings.local', path.join(linked, 'notes.ts'));
            fs.writeFileSync(path.join(linked, 'plain.ts'), 'export const d = 4;\n');

            const contents = await getFileContents(await getChangedFiles(linked), linked);
            expect(contents['notes.ts']).toBeUndefined();
            expect(contents['plain.ts']).toBe('export const d = 4;\n');
        } finally {
            fs.rmSync(linked, { recursive: true, force: true });
        }
    });
});
