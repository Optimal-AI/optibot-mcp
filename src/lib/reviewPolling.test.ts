import { describe, it, expect, vi } from 'vitest';
import { waitForReviewResult, ReviewResultFetcher } from './reviewPolling.js';
import { ReviewResultResponse } from '../types.js';

const fetcher = (results: ReviewResultResponse[]): ReviewResultFetcher => {
    const queue = [...results];
    return {
        getReviewResult: vi.fn(async () => queue.shift() ?? { status: 'pending' }),
    };
};

// No real waiting in tests.
const noSleep = () => Promise.resolve();

describe('waitForReviewResult', () => {
    it('returns immediately when the first poll is done', async () => {
        const done: ReviewResultResponse = { status: 'done', generalComment: 'ok' };
        const client = fetcher([done]);

        const result = await waitForReviewResult(client, 'apirev_x', { sleep: noSleep });

        expect(result).toEqual(done);
        expect(client.getReviewResult).toHaveBeenCalledTimes(1);
    });

    it('returns the failed result', async () => {
        const client = fetcher([{ status: 'failed', error: 'boom' }]);
        const result = await waitForReviewResult(client, 'apirev_x', { sleep: noSleep });
        expect(result).toEqual({ status: 'failed', error: 'boom' });
    });

    it('keeps polling through pending and not_found until done', async () => {
        const client = fetcher([
            { status: 'not_found' },
            { status: 'pending' },
            { status: 'pending' },
            { status: 'done', generalComment: 'ok' },
        ]);

        const result = await waitForReviewResult(client, 'apirev_x', { sleep: noSleep });

        expect(result).toEqual({ status: 'done', generalComment: 'ok' });
        expect(client.getReviewResult).toHaveBeenCalledTimes(4);
    });

    it('throws when it exceeds the timeout', async () => {
        // Always pending; a clock that jumps past the timeout after the first poll.
        const client: ReviewResultFetcher = {
            getReviewResult: vi.fn(async () => ({ status: 'pending' })),
        };
        let t = 0;
        const now = () => {
            const value = t;
            t += 1000; // advance 1s per read
            return value;
        };

        await expect(
            waitForReviewResult(client, 'apirev_x', { timeoutMs: 1500, sleep: noSleep, now }),
        ).rejects.toThrow('Timed out');
    });
});
