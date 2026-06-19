import { ReviewResultResponse } from '../types.js';

/** Terminal states of a review. */
export type TerminalReviewResult = Extract<
    ReviewResultResponse,
    { status: 'done' } | { status: 'failed' }
>;

/** Minimal surface needed to poll for a review result (the ApiClient satisfies it). */
export interface ReviewResultFetcher {
    getReviewResult(reviewId: string): Promise<ReviewResultResponse>;
}

export interface WaitForReviewResultOptions {
    /** Give up after this long. Default 20 minutes. */
    timeoutMs?: number;
    /** Delay between polls. Default 3 seconds. */
    intervalMs?: number;
    /** Injectable clock, for tests. */
    now?: () => number;
    /** Injectable delay, for tests. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll for an async review's result until it reaches a terminal state.
 *
 * `pending` and the brief post-enqueue `not_found` race both mean "keep
 * waiting": the job was accepted (the POST returned a reviewId), so the result
 * is on its way. Throws on timeout.
 */
export async function waitForReviewResult(
    client: ReviewResultFetcher,
    reviewId: string,
    options: WaitForReviewResultOptions = {},
): Promise<TerminalReviewResult> {
    const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
    const intervalMs = options.intervalMs ?? 3000;
    const now = options.now ?? (() => Date.now());
    const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const start = now();

    for (;;) {
        const result = await client.getReviewResult(reviewId);
        if (result.status === 'done' || result.status === 'failed') {
            return result;
        }

        if (now() - start >= timeoutMs) {
            throw new Error('Timed out waiting for the review result.');
        }

        await sleep(intervalMs);
    }
}
