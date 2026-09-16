import { AgentReviewResultResponse } from '../types.js';

/** Terminal states of an agent review. */
export type TerminalAgentReviewResult = Extract<
    AgentReviewResultResponse,
    { status: 'done' } | { status: 'failed' }
>;

/** Minimal client shape needed to poll for an agent review result. */
export interface AgentReviewResultFetcher {
    getAgentReviewResult(reviewId: string): Promise<AgentReviewResultResponse>;
}

export interface WaitForAgentReviewResultOptions {
    /** Give up after this long. */
    timeoutMs?: number;
    /** Delay between polls. */
    intervalMs?: number;
    /** Injectable clock, for tests. */
    now?: () => number;
    /** Injectable delay, for tests. */
    sleep?: (ms: number) => Promise<void>;
    /**
     * Called once per poll with the seconds elapsed so far. A review can run
     * for minutes and the tool is otherwise silent for all of it, which reads
     * to a host as a hung call — some cancel on their own timeout. Emitting on
     * each tick also refreshes the timeout of any client that resets it on
     * activity.
     */
    onPoll?: (elapsedSeconds: number) => void;
}

/**
 * The server aborts an agent review at its own 10-minute hard timeout, so a
 * shorter budget would abandon a review that is still running and still being
 * billed. The extra 5 minutes covers time the job spends queued behind other
 * reviews.
 */
export const DEFAULT_AGENT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

/** Agent mode is the fast, tool-less pipeline, so it polls on a short interval. */
export const DEFAULT_AGENT_POLL_INTERVAL_MS = 1000;

/**
 * Consecutive `not_found` answers tolerated before treating the review as gone.
 * A poll issued right after the submit can race the job becoming visible, so a
 * single `not_found` is not terminal; a persistent one means the job or its
 * result expired.
 */
export const MAX_CONSECUTIVE_NOT_FOUND = 3;

/**
 * Consecutive poll failures tolerated before the review is abandoned. A single
 * network blip is not an outage, and the server keeps working either way.
 */
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/**
 * Polls for an async agent review's result until it reaches a terminal state.
 * Throws on timeout, and on a `not_found` that repeats.
 */
export async function waitForAgentReviewResult(
    client: AgentReviewResultFetcher,
    reviewId: string,
    options: WaitForAgentReviewResultOptions = {},
): Promise<TerminalAgentReviewResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_POLL_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_AGENT_POLL_INTERVAL_MS;
    const now = options.now ?? (() => Date.now());
    const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const start = now();
    let consecutiveNotFound = 0;
    let consecutiveErrors = 0;

    for (;;) {
        options.onPoll?.(Math.round((now() - start) / 1000));

        // A momentary network failure on one poll must not abandon a review
        // the server is still running and still billing. Only a run of them
        // is treated as a real outage. Observed in practice: a single
        // `fetch failed` against a healthy backend, where the next poll
        // succeeded.
        let result: AgentReviewResultResponse;
        try {
            result = await client.getAgentReviewResult(reviewId);
            consecutiveErrors = 0;
        } catch (err) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_FAILURES) throw err;
            if (now() - start >= timeoutMs) {
                throw new Error('Timed out waiting for the agent review result.');
            }
            await sleep(intervalMs);
            continue;
        }

        if (result.status === 'done' || result.status === 'failed') {
            return result;
        }

        if (result.status === 'not_found') {
            consecutiveNotFound++;
            if (consecutiveNotFound >= MAX_CONSECUTIVE_NOT_FOUND) {
                throw new Error('The agent review result was not found — it may have expired. Run the review again.');
            }
        } else {
            consecutiveNotFound = 0;
        }

        if (now() - start >= timeoutMs) {
            throw new Error('Timed out waiting for the agent review result.');
        }

        await sleep(intervalMs);
    }
}
