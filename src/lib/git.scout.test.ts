/**
 * The scout helpers in git.ts, run against a real temporary repository: the
 * gitignore check and the tracked-file list are only worth testing against
 * git itself. git.test.ts mocks child_process and fs, so these live apart.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createUploadBudget, getTrackedFiles, gitIgnoreStatus, readScoutedFile } from './git.js';

let repo: string;

function write(relative: string, content: string | Buffer): void {
    const full = path.join(repo, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-scout-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    write('.gitignore', 'local.cfg\nbuild/\n');
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 2;\n');
    write('-dash.ts', 'export const dash = 3;\n');
    write('local.cfg', 'setting=1\n');
    write('build/out.js', 'built\n');
    write('img/raw.dat', Buffer.from([0, 1, 2, 3, 0, 5, 6, 7]));
    write('src/creds.ts', `export const k = "${'AKIA' + 'B'.repeat(16)}";\n`);
    write('src/big.ts', 'x'.repeat(2048));
    execFileSync('git', ['add', '.gitignore', 'src', '-f', '--', '-dash.ts', 'img'], { cwd: repo });
    fs.symlinkSync(path.join(repo, 'local.cfg'), path.join(repo, 'src', 'link.ts'));
});

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

describe('getTrackedFiles', () => {
    it('lists tracked paths only, without ignored or untracked files', async () => {
        const tracked = await getTrackedFiles(repo);
        expect(tracked).toEqual(expect.arrayContaining(['.gitignore', 'src/a.ts', 'src/b.ts', '-dash.ts']));
        expect(tracked).not.toContain('local.cfg');
        expect(tracked).not.toContain('build/out.js');
        expect(tracked).not.toContain('src/link.ts');
    });
});

describe('gitIgnoreStatus', () => {
    it('reports an ignored path', async () => {
        expect(await gitIgnoreStatus(repo, ['local.cfg'])).toBe('ignored');
    });

    it('reports a path that is not ignored', async () => {
        expect(await gitIgnoreStatus(repo, ['src/a.ts'])).toBe('not-ignored');
    });

    it('checks an absolute path against the repository root', async () => {
        expect(await gitIgnoreStatus(repo, [path.join(fs.realpathSync(repo), 'build', 'out.js')])).toBe('ignored');
    });

    it('reports ignored when any of several paths is ignored', async () => {
        expect(await gitIgnoreStatus(repo, ['src/a.ts', 'local.cfg'])).toBe('ignored');
    });

    it('does not read a path that starts with a dash as an option', async () => {
        expect(await gitIgnoreStatus(repo, ['-dash.ts'])).toBe('not-ignored');
    });

    it('reports unknown outside a repository', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-norepo-'));
        try {
            expect(await gitIgnoreStatus(outside, ['a.ts'])).toBe('unknown');
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});

describe('readScoutedFile', () => {
    it('reads a tracked text file and spends its size from the budget', async () => {
        const budget = createUploadBudget(1000);
        const read = await readScoutedFile('src/a.ts', repo, budget);
        expect(read).toEqual({ ok: true, content: 'export const a = 1;\n' });
        expect(budget.remaining()).toBe(1000 - 'export const a = 1;\n'.length);
    });

    it('refuses a path outside the repository', async () => {
        const read = await readScoutedFile('../outside.ts', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('not a readable file inside the repository') });
    });

    it('refuses a sensitive file name', async () => {
        write('.env', 'A=1\n');
        const read = await readScoutedFile('.env', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('potentially sensitive') });
    });

    it('refuses a binary extension before touching the content', async () => {
        write('src/logo.png', 'not really a png');
        const read = await readScoutedFile('src/logo.png', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('binary') });
    });

    it('refuses an ignored file', async () => {
        const read = await readScoutedFile('local.cfg', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('ignored by git') });
    });

    it('refuses a tracked-looking link to an ignored file', async () => {
        const read = await readScoutedFile('src/link.ts', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('ignored by git') });
    });

    it('refuses a tracked symlink into the .git directory', async () => {
        fs.symlinkSync(path.join('.git', 'config'), path.join(repo, 'notes.md'));
        execFileSync('git', ['add', 'notes.md'], { cwd: repo });
        expect(await getTrackedFiles(repo)).toContain('notes.md');

        const read = await readScoutedFile('notes.md', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('inside the .git directory') });
    });

    it('refuses a path that names the .git directory directly', async () => {
        const read = await readScoutedFile('.git/config', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('inside the .git directory') });
    });

    it('refuses binary content under a text-looking name', async () => {
        const read = await readScoutedFile('img/raw.dat', repo, createUploadBudget());
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('binary') });
    });

    it('refuses a file whose content holds a credential, and spends nothing', async () => {
        const budget = createUploadBudget(10_000);
        const read = await readScoutedFile('src/creds.ts', repo, budget);
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('AWS access key') });
        expect(budget.remaining()).toBe(10_000);
    });

    it('refuses a file that does not fit the remaining budget, before reading it', async () => {
        const budget = createUploadBudget(100);
        const read = await readScoutedFile('src/big.ts', repo, budget);
        expect(read).toEqual({ ok: false, warning: expect.stringContaining('upload budget exceeded') });
        expect(budget.remaining()).toBe(100);
    });

    it('refuses a file that does not exist', async () => {
        const read = await readScoutedFile('src/missing.ts', repo, createUploadBudget());
        expect(read.ok).toBe(false);
    });

    it('refuses the read when git cannot answer the ignore check', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-norepo-'));
        try {
            fs.writeFileSync(path.join(outside, 'a.ts'), 'x\n');
            const read = await readScoutedFile('a.ts', outside, createUploadBudget());
            expect(read).toEqual({ ok: false, warning: expect.stringContaining('could not check whether it is ignored') });
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
