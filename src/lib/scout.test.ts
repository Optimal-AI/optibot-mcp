import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTrackedFiles = vi.fn();
const mockReadScoutedFile = vi.fn();

vi.mock('./git.js', () => ({
    getTrackedFiles: (...args: unknown[]) => mockGetTrackedFiles(...args),
    readScoutedFile: (...args: unknown[]) => mockReadScoutedFile(...args),
}));

import {
    AGENT_SCOUT_MAX_PATH_LIST_CHARS,
    AGENT_SCOUT_MIN_CHANGED_LINES,
    capRepositoryPaths,
    countChangedLines,
    normalizeContextPath,
    runScout,
} from './scout.js';
import { createUploadBudget } from './git.js';

/** A one-file diff with `n` added lines. */
function patchWithLines(n: number): string {
    const body = Array.from({ length: n }, (_, i) => `+line ${i}`).join('\n');
    return `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,${n} @@\n${body}\n`;
}

const LARGE = patchWithLines(AGENT_SCOUT_MIN_CHANGED_LINES);
const budget = { canFit: () => true, spend: () => {}, remaining: () => 1 } as ReturnType<typeof createUploadBudget>;

function client(answer: unknown) {
    return { scoutAgentContext: vi.fn().mockImplementation(async () => answer) };
}

beforeEach(() => {
    mockGetTrackedFiles.mockReset().mockResolvedValue(['a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    mockReadScoutedFile.mockReset().mockImplementation(async (p: string) => ({ ok: true, content: `content of ${p}` }));
});

describe('countChangedLines', () => {
    it('counts added and removed lines inside hunks only', () => {
        const patch = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,3 +1,3 @@',
            ' context',
            '-old',
            '+new',
            '--- removed line that starts with dashes',
            'diff --git a/y.ts b/y.ts',
            '--- a/y.ts',
            '+++ b/y.ts',
        ].join('\n');
        expect(countChangedLines(patch)).toBe(3);
    });

    it('is zero for an empty patch', () => {
        expect(countChangedLines('')).toBe(0);
    });
});

describe('normalizeContextPath', () => {
    it.each([
        ['./src/a.ts', 'src/a.ts'],
        ['src\\a.ts', 'src/a.ts'],
        ['src/./a.ts', 'src/a.ts'],
        ['src/a.ts', 'src/a.ts'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeContextPath(input)).toBe(expected);
    });
});

describe('capRepositoryPaths', () => {
    it('returns the list unchanged when it fits', () => {
        const paths = ['a.ts', 'src/b.ts'];
        expect(capRepositoryPaths(paths, ['src/x.ts'], 100)).toBe(paths);
    });

    it('keeps the paths nearest the anchors first, in their original order within a depth', () => {
        const paths = ['z/far.ts', 'src/other/o.ts', 'src/api/a.ts', 'root.ts', 'src/api/b.ts'];
        // Each path costs its length plus one: room for the two src/api files and src/other/o.ts.
        const room = 'src/api/a.ts'.length + 'src/api/b.ts'.length + 'src/other/o.ts'.length + 3;
        expect(capRepositoryPaths(paths, ['src/api/changed.ts'], room)).toEqual([
            'src/api/a.ts',
            'src/api/b.ts',
            'src/other/o.ts',
        ]);
    });

    it('counts one separator per path and skips a path that does not fit for a shorter one that does', () => {
        const paths = ['src/a-very-long-name.ts', 'src/b.ts'];
        expect(capRepositoryPaths(paths, ['src/x.ts'], 'src/b.ts'.length + 1)).toEqual(['src/b.ts']);
    });

    it('treats a root-level anchor as sharing no directory', () => {
        const paths = ['b.ts', 'a/c.ts'];
        expect(capRepositoryPaths(paths, ['x.ts'], 'b.ts'.length + 1)).toEqual(['b.ts']);
    });
});

describe('runScout', () => {
    it('sends a capped path list when the repository is larger than the cap', async () => {
        const many = Array.from({ length: 5 }, (_, i) => `vendor/${'x'.repeat(AGENT_SCOUT_MAX_PATH_LIST_CHARS / 4)}${i}.ts`);
        mockGetTrackedFiles.mockResolvedValue(['src/near.ts', ...many]);
        const c = client({ paths: [], skipped: false });
        await runScout(c, { patch: LARGE, providedPaths: ['src/changed.ts'] }, '/repo', budget);
        const sent = c.scoutAgentContext.mock.calls[0][0].repositoryPaths as string[];
        expect(sent[0]).toBe('src/near.ts');
        expect(sent.reduce((n, p) => n + p.length + 1, 0)).toBeLessThanOrEqual(AGENT_SCOUT_MAX_PATH_LIST_CHARS);
        expect(sent.length).toBeLessThan(6);
    });

    it('skips a small change without calling the backend', async () => {
        const c = client({ paths: [], skipped: false });
        const out = await runScout(c, { patch: patchWithLines(AGENT_SCOUT_MIN_CHANGED_LINES - 1), providedPaths: [] }, '/repo', budget);
        expect(c.scoutAgentContext).not.toHaveBeenCalled();
        expect(out).toEqual({ files: [], meta: { durationMs: 0, files: [], skipped: true, reason: 'small_change' }, warnings: [] });
    });

    it('sends the patch, the deduplicated provided paths, the tracked paths, and the repository name', async () => {
        const c = client({ paths: [], skipped: false });
        await runScout(c, { patch: LARGE, repositoryName: 'acme/app', providedPaths: ['a.ts', './a.ts', 'src\\b.ts'] }, '/repo', budget);
        expect(c.scoutAgentContext).toHaveBeenCalledWith({
            patch: LARGE,
            providedPaths: ['a.ts', 'src/b.ts'],
            repositoryPaths: ['a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
            repositoryName: 'acme/app',
        });
    });

    it('reads the picked files in rank order and returns them with the ticket', async () => {
        const c = client({ paths: [{ path: 'src/d.ts', rank: 2 }, { path: 'src/c.ts', rank: 1 }], skipped: false, reviewTicket: 't-1' });
        const out = await runScout(c, { patch: LARGE, providedPaths: ['a.ts'] }, '/repo', budget);
        expect(out.files).toEqual([
            { path: 'src/c.ts', content: 'content of src/c.ts' },
            { path: 'src/d.ts', content: 'content of src/d.ts' },
        ]);
        expect(out.reviewTicket).toBe('t-1');
        expect(out.meta).toEqual({ durationMs: expect.any(Number), files: ['src/c.ts', 'src/d.ts'], skipped: false });
        expect(out.warnings).toEqual([]);
        expect(mockReadScoutedFile).toHaveBeenCalledWith('src/c.ts', '/repo', budget);
    });

    it('drops paths it did not send as tracked, paths already provided, duplicates, and entries without a numeric rank', async () => {
        const c = client({
            paths: [
                { path: '../../etc/passwd', rank: 1 },
                { path: 'a.ts', rank: 2 },
                { path: './src/c.ts', rank: 3 },
                { path: 'src/c.ts', rank: 4 },
                { path: 'src/d.ts', rank: 'first' },
                { rank: 5 },
            ],
            skipped: false,
        });
        const out = await runScout(c, { patch: LARGE, providedPaths: ['a.ts'] }, '/repo', budget);
        expect(out.files.map((f) => f.path)).toEqual(['src/c.ts']);
        expect(mockReadScoutedFile).toHaveBeenCalledTimes(1);
    });

    it('tells the host which files it will read before reading them', async () => {
        const sendNotification = vi.fn();
        const c = client({ paths: [{ path: 'src/c.ts', rank: 1 }], skipped: false });
        await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget, { sendNotification });
        expect(sendNotification).toHaveBeenCalledWith({
            method: 'notifications/message',
            params: { level: 'info', logger: 'optibot', data: expect.stringContaining('src/c.ts') },
        });
        expect(sendNotification.mock.invocationCallOrder[0]).toBeLessThan(mockReadScoutedFile.mock.invocationCallOrder[0]);
    });

    it('keeps a file it could not read out of the result and reports why', async () => {
        mockReadScoutedFile.mockImplementation(async (p: string) =>
            p === 'src/c.ts' ? { ok: false, warning: 'Skipped scouted file: it is ignored by git: src/c.ts' } : { ok: true, content: 'd' });
        const c = client({ paths: [{ path: 'src/c.ts', rank: 1 }, { path: 'src/d.ts', rank: 2 }], skipped: false });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.files.map((f) => f.path)).toEqual(['src/d.ts']);
        expect(out.meta.files).toEqual(['src/d.ts']);
        expect(out.warnings).toEqual(['Skipped scouted file: it is ignored by git: src/c.ts']);
    });

    it('reports a scout that ran and picked nothing new as not skipped, and keeps the ticket', async () => {
        const c = client({ paths: [{ path: 'a.ts', rank: 1 }], skipped: false, reviewTicket: 't-2' });
        const out = await runScout(c, { patch: LARGE, providedPaths: ['a.ts'] }, '/repo', budget);
        expect(out).toEqual({ files: [], reviewTicket: 't-2', meta: { durationMs: expect.any(Number), files: [], skipped: false }, warnings: [] });
    });

    it('keeps the ticket and the backend reason when the scout skipped', async () => {
        const c = client({ paths: [], skipped: true, reason: 'input_too_large', reviewTicket: 't-3' });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out).toEqual({ files: [], reviewTicket: 't-3', meta: { durationMs: expect.any(Number), files: [], skipped: true, reason: 'input_too_large' }, warnings: [] });
    });

    it('leaves out a skip reason it does not know', async () => {
        const c = client({ paths: [], skipped: true, reason: '\u001b[31minjected' });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.meta).toEqual({ durationMs: expect.any(Number), files: [], skipped: true });
    });

    it('ignores an empty ticket', async () => {
        const c = client({ paths: [], skipped: false, reviewTicket: '' });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.reviewTicket).toBeUndefined();
    });

    it('treats a 404 from an older backend as no files', async () => {
        const c = client(null);
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out).toEqual({ files: [], meta: { durationMs: expect.any(Number), files: [], skipped: true }, warnings: [] });
    });

    it('treats an answer without a paths list as no files', async () => {
        const c = client({ skipped: false });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.files).toEqual([]);
        expect(out.meta.skipped).toBe(true);
    });

    it('reports a timeout as reason timeout', async () => {
        const c = { scoutAgentContext: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })) };
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.meta).toEqual({ durationMs: expect.any(Number), files: [], skipped: true, reason: 'timeout' });
    });

    it('treats any other error, such as a 429, as no files without a reason', async () => {
        const c = { scoutAgentContext: vi.fn().mockRejectedValue(Object.assign(new Error('limit'), { status: 429 })) };
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(out.meta).toEqual({ durationMs: expect.any(Number), files: [], skipped: true });
    });

    it('does not call the backend when git cannot list the tracked files', async () => {
        mockGetTrackedFiles.mockRejectedValue(new Error('not a repository'));
        const c = client({ paths: [], skipped: false });
        const out = await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(c.scoutAgentContext).not.toHaveBeenCalled();
        expect(out.meta.skipped).toBe(true);
    });

    it('does not call the backend when the repository tracks no files', async () => {
        mockGetTrackedFiles.mockResolvedValue([]);
        const c = client({ paths: [], skipped: false });
        await runScout(c, { patch: LARGE, providedPaths: [] }, '/repo', budget);
        expect(c.scoutAgentContext).not.toHaveBeenCalled();
    });
});
