import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { gitIgnoreStatus } from './git.js';

const HAS_GIT = (() => {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

// git.test.ts mocks child_process, so it cannot catch a git command git itself
// rejects. This file runs real git in a throwaway repository. It exists because
// `git check-ignore -q` accepts only one path and exits 128 with two, which made
// every requested context file look "unknown" and be refused. Skipped where the
// git binary is not installed, so the suite stays deterministic without it.
describe.skipIf(!HAS_GIT)('gitIgnoreStatus', () => {
    let repo: string;

    beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-gitignore-'));
        execFileSync('git', ['init', '-q'], { cwd: repo });
        fs.writeFileSync(path.join(repo, '.gitignore'), '*.local\n');
        fs.mkdirSync(path.join(repo, 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'ok.ts'), 'export const ok = 1;\n');
        fs.writeFileSync(path.join(repo, 'settings.local'), 'local only\n');
    });

    afterAll(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('is "not-ignored" for a requested path and its resolved path when neither is ignored', async () => {
        const status = await gitIgnoreStatus(repo, ['src/ok.ts', path.join(fs.realpathSync(repo), 'src', 'ok.ts')]);

        expect(status).toBe('not-ignored');
    });

    it('is "ignored" when either of the two paths is ignored', async () => {
        const status = await gitIgnoreStatus(repo, ['src/ok.ts', path.join(fs.realpathSync(repo), 'settings.local')]);

        expect(status).toBe('ignored');
    });

    it('is "unknown" outside a git repository', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'optibot-norepo-'));

        try {
            const status = await gitIgnoreStatus(outside, ['a.ts', 'b.ts']);

            expect(status).toBe('unknown');
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
