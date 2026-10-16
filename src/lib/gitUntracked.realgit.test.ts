import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getDiffHead } from './git.js';

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
});
