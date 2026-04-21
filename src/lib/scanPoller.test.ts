import { describe, it, expect, vi } from 'vitest';
import { waitForScanCompletion } from './scanPoller.js';
import type { ApiClient } from './api.js';

function makeClient(pages: Array<{ items: Array<{ id: number; repositoryId: number; createdAt: string; status: string }> }>): ApiClient {
    let call = 0;
    return {
        listSecurityIssues: vi.fn(async () => {
            const page = pages[Math.min(call, pages.length - 1)];
            call += 1;
            // Fill in the response shape expected by ApiClient.listSecurityIssues
            return {
                items: page.items,
                totalItems: page.items.length,
                page: 1,
                pageSize: 1,
                totalPages: 1,
            };
        }),
    } as unknown as ApiClient;
}

describe('waitForScanCompletion', () => {
    it('returns the first scan newer than sinceIso', async () => {
        const client = makeClient([
            { items: [{ id: 1, repositoryId: 10, createdAt: '2026-04-21T10:00:00Z', status: 'completed' }] },
            { items: [{ id: 2, repositoryId: 10, createdAt: '2026-04-21T12:00:00Z', status: 'completed' }] },
        ]);

        const result = await waitForScanCompletion(client, {
            repositoryId: 10,
            sinceIso: '2026-04-21T11:00:00Z',
            pollIntervalMs: 0,
            sleep: async () => {},
            now: (() => { let t = 0; return () => (t += 1); })(),
        });

        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.result.id).toBe(2);
        }
    });

    it('returns timeout when no matching scan appears within budget', async () => {
        const client = makeClient([
            { items: [{ id: 1, repositoryId: 10, createdAt: '2026-04-21T09:00:00Z', status: 'completed' }] },
        ]);

        let fakeTime = 0;
        const result = await waitForScanCompletion(client, {
            repositoryId: 10,
            sinceIso: '2026-04-21T11:00:00Z',
            pollIntervalMs: 1,
            timeoutMs: 5,
            sleep: async () => { fakeTime += 2; },
            now: () => fakeTime,
        });

        expect(result.status).toBe('timeout');
    });

    it('returns the first item when no sinceIso is provided', async () => {
        const client = makeClient([
            { items: [{ id: 42, repositoryId: 10, createdAt: '2026-04-21T10:00:00Z', status: 'completed' }] },
        ]);

        const result = await waitForScanCompletion(client, {
            repositoryId: 10,
            pollIntervalMs: 0,
            sleep: async () => {},
        });

        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.result.id).toBe(42);
        }
    });

    it('invokes onPoll for each attempt', async () => {
        const client = makeClient([
            { items: [] },
            { items: [{ id: 1, repositoryId: 10, createdAt: '2026-04-21T12:00:00Z', status: 'completed' }] },
        ]);

        const onPoll = vi.fn();
        let fakeTime = 0;
        await waitForScanCompletion(client, {
            repositoryId: 10,
            sinceIso: '2026-04-21T11:00:00Z',
            pollIntervalMs: 1,
            timeoutMs: 1_000_000,
            sleep: async () => { fakeTime += 2; },
            now: () => fakeTime,
            onPoll,
        });

        expect(onPoll).toHaveBeenCalled();
        expect(onPoll.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
