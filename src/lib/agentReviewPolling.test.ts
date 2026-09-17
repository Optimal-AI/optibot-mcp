import { describe, it, expect, vi } from 'vitest';
import { waitForAgentReviewResult, MAX_CONSECUTIVE_NOT_FOUND, MAX_CONSECUTIVE_POLL_FAILURES } from './agentReviewPolling.js';

const noSleep = () => Promise.resolve();

function fetcher(results: any[]) {
    const getAgentReviewResult = vi.fn();
    for (const result of results) {
        getAgentReviewResult.mockResolvedValueOnce(result);
    }
    getAgentReviewResult.mockResolvedValue(results[results.length - 1]);
    return { getAgentReviewResult };
}

describe('waitForAgentReviewResult', () => {
    it('returns the done result once the job finishes', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const client = fetcher([{ status: 'pending' }, done]);

        const result = await waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep });

        expect(result).toBe(done);
        expect(client.getAgentReviewResult).toHaveBeenCalledTimes(2);
        expect(client.getAgentReviewResult).toHaveBeenCalledWith('rev-1');
    });

    it('returns a failed result rather than throwing, so the caller can read errorType', async () => {
        const failed = { status: 'failed', error: 'too big', errorType: 'context_window_exceeded' };
        const client = fetcher([failed]);

        const result = await waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep });

        expect(result).toEqual(failed);
    });

    it('keeps waiting through a single not_found, which races the job becoming visible', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const client = fetcher([{ status: 'not_found' }, done]);

        const result = await waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep });

        expect(result).toBe(done);
    });

    it('gives up when not_found repeats', async () => {
        const client = fetcher([{ status: 'not_found' }]);

        await expect(
            waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep }),
        ).rejects.toThrow('may have expired');

        expect(client.getAgentReviewResult).toHaveBeenCalledTimes(MAX_CONSECUTIVE_NOT_FOUND);
    });

    it('resets the not_found count when a pending answer arrives in between', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const client = fetcher([
            { status: 'not_found' },
            { status: 'not_found' },
            { status: 'pending' },
            { status: 'not_found' },
            done,
        ]);

        const result = await waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep });

        expect(result).toBe(done);
    });

    it('throws when the review never finishes within the budget', async () => {
        const client = fetcher([{ status: 'pending' }]);
        let clock = 0;

        await expect(
            waitForAgentReviewResult(client as any, 'rev-1', {
                sleep: noSleep,
                timeoutMs: 10,
                now: () => (clock += 20),
            }),
        ).rejects.toThrow('Timed out');
    });
});

describe('waitForAgentReviewResult progress', () => {
    it('reports on every poll so a silent tool call does not read as hung', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const client = fetcher([{ status: 'pending' }, { status: 'pending' }, done]);
        const seen: number[] = [];
        let clock = 0;

        await waitForAgentReviewResult(client as any, 'rev-1', {
            sleep: noSleep,
            now: () => (clock += 1000),
            onPoll: (elapsed) => seen.push(elapsed),
        });

        expect(seen).toHaveLength(3);
        expect(seen[0]).toBeGreaterThanOrEqual(0);
    });

    it('does not require an onPoll callback', async () => {
        const client = fetcher([{ status: 'done', result: {} }]);
        await expect(
            waitForAgentReviewResult(client as any, 'rev-1', { sleep: noSleep }),
        ).resolves.toBeDefined();
    });
});

describe('waitForAgentReviewResult transient failures', () => {
    it('survives a single failed poll and delivers the result', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const getAgentReviewResult = vi.fn()
            .mockRejectedValueOnce(new Error('fetch failed'))
            .mockResolvedValueOnce(done);

        const result = await waitForAgentReviewResult(
            { getAgentReviewResult } as any,
            'rev-1',
            { sleep: noSleep },
        );

        expect(result).toBe(done);
        expect(getAgentReviewResult).toHaveBeenCalledTimes(2);
    });

    it('gives up once failures repeat', async () => {
        const getAgentReviewResult = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

        await expect(
            waitForAgentReviewResult({ getAgentReviewResult } as any, 'rev-1', { sleep: noSleep }),
        ).rejects.toThrow('ECONNRESET');

        expect(getAgentReviewResult).toHaveBeenCalledTimes(MAX_CONSECUTIVE_POLL_FAILURES);
    });

    it('resets the failure count after a successful poll', async () => {
        const done = { status: 'done', result: { summary: 'ready' } };
        const getAgentReviewResult = vi.fn()
            .mockRejectedValueOnce(new Error('blip'))
            .mockRejectedValueOnce(new Error('blip'))
            .mockResolvedValueOnce({ status: 'pending' })
            .mockRejectedValueOnce(new Error('blip'))
            .mockResolvedValueOnce(done);

        const result = await waitForAgentReviewResult(
            { getAgentReviewResult } as any,
            'rev-1',
            { sleep: noSleep },
        );

        expect(result).toBe(done);
    });
});
