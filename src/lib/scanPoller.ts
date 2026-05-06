import { ApiClient } from './api.js';
import { SecurityScanResult } from '../types.js';

export interface WaitOptions {
    repositoryId: number;
    /** Ignore results whose createdAt is at or before this timestamp. */
    sinceIso?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
    onPoll?: (attempt: number) => void;
    /** Injected for tests; defaults to setTimeout. */
    sleep?: (ms: number) => Promise<void>;
    /** Injected for tests; defaults to Date.now(). */
    now?: () => number;
}

export type WaitResult =
    | { status: 'completed'; result: SecurityScanResult }
    | { status: 'timeout' };

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Poll `listSecurityIssues({ repositoryIds: [id], pageSize: 1 })` every
 * `pollIntervalMs` until a scan newer than `sinceIso` appears, or the
 * overall `timeoutMs` budget is exhausted. The BE's 202 response doesn't
 * include the final scan row — this picks it up so the caller can surface
 * actual cost + severity.
 */
export async function waitForScanCompletion(
    client: ApiClient,
    opts: WaitOptions,
): Promise<WaitResult> {
    const pollIntervalMs = opts.pollIntervalMs ?? 5000;
    const timeoutMs = opts.timeoutMs ?? 600_000;
    const sleep = opts.sleep ?? defaultSleep;
    const now = opts.now ?? (() => Date.now());
    const start = now();

    let attempt = 0;
    while (now() - start < timeoutMs) {
        attempt += 1;
        if (opts.onPoll) opts.onPoll(attempt);

        const page = await client.listSecurityIssues({
            repositoryIds: [opts.repositoryId],
            page: 1,
            pageSize: 1,
        });

        const top = page.items[0];
        if (top && isNewer(top.createdAt, opts.sinceIso)) {
            return { status: 'completed', result: top };
        }

        await sleep(pollIntervalMs);
    }

    return { status: 'timeout' };
}

function isNewer(candidate: string, sinceIso?: string): boolean {
    if (!sinceIso) return true;
    const a = Date.parse(candidate);
    const b = Date.parse(sinceIso);
    if (Number.isNaN(a) || Number.isNaN(b)) return true;
    return a > b;
}
