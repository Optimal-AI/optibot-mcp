import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

import { ApiClient } from './api.js';

describe('ApiClient', () => {
    let client: ApiClient;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        client = new ApiClient('test-api-key');
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    function mockOkResponse(body: Record<string, any>) {
        fetchMock.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(body),
        });
    }

    function mockErrorResponse(status: number, body?: Record<string, any>) {
        fetchMock.mockResolvedValue({
            ok: false,
            status,
            statusText: 'Error',
            json: body
                ? () => Promise.resolve(body)
                : () => Promise.reject(new Error('not json')),
        });
    }

    describe('review', () => {
        it('sends POST to /api/review with correct headers', async () => {
            mockOkResponse({});
            await client.review({ patch: 'diff' });

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/review',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test-api-key',
                    }),
                })
            );
        });

        it('base64-encodes the patch in the request body', async () => {
            mockOkResponse({});
            await client.review({ patch: 'hello diff' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.patch).toBe(Buffer.from('hello diff').toString('base64'));
        });

        it('base64-encodes file contents when files are provided', async () => {
            mockOkResponse({});
            await client.review({
                patch: 'x',
                files: { 'a.ts': 'file content' },
            });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files['a.ts']).toBe(
                Buffer.from('file content').toString('base64')
            );
        });

        it('omits files from body when undefined', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files).toBeUndefined();
        });

        it('omits files from body when empty object', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x', files: {} });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files).toBeUndefined();
        });

        it('includes repositoryName when provided', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x', repositoryName: 'my-repo' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.repositoryName).toBe('my-repo');
        });

        it('omits repositoryName when not provided', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.repositoryName).toBeUndefined();
        });

        it('sets async true in the request body', async () => {
            mockOkResponse({ reviewId: 'apirev_x' });
            await client.review({ patch: 'x' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.async).toBe(true);
        });

        it('returns the reviewId and reviewCount from the 202 receipt', async () => {
            const reviewCount = { current: 5, limit: 100, remaining: 95 };
            mockOkResponse({ reviewId: 'apirev_abc', reviewCount });

            const result = await client.review({ patch: 'x' });
            expect(result.reviewId).toBe('apirev_abc');
            expect(result.reviewCount).toEqual(reviewCount);
        });

        it('passes through reviewCount unchanged', async () => {
            const reviewCount = { current: 5, limit: 100, remaining: 95 };
            mockOkResponse({ reviewCount });

            const result = await client.review({ patch: 'x' });
            expect(result.reviewCount).toEqual(reviewCount);
        });

        it('throws error with message from API when response is not ok', async () => {
            mockErrorResponse(400, { message: 'Bad input' });
            await expect(client.review({ patch: 'x' })).rejects.toThrow('Bad input');
        });

        it('throws with default message when API error body is not JSON', async () => {
            mockErrorResponse(500);
            await expect(client.review({ patch: 'x' })).rejects.toThrow('API request failed');
        });

        it('attaches status to the thrown error', async () => {
            mockErrorResponse(401, { message: 'Unauthorized' });

            try {
                await client.review({ patch: 'x' });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.status).toBe(401);
            }
        });

        it('attaches data to the thrown error', async () => {
            mockErrorResponse(403, { message: 'Forbidden', error: 'No seat' });

            try {
                await client.review({ patch: 'x' });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.data).toEqual({ message: 'Forbidden', error: 'No seat' });
            }
        });
    });

    describe('createApiKey', () => {
        it('sends POST to /api/keys with correct headers and body', async () => {
            mockOkResponse({ id: 1, name: 'ci', keyPrefix: 'optk', key: 'optk_abc', createdAt: '2026-01-01' });
            await client.createApiKey('ci');

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/keys',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test-api-key',
                    }),
                    body: JSON.stringify({ name: 'ci' }),
                })
            );
        });

        it('returns parsed response on success', async () => {
            const body = { id: 1, name: 'ci', keyPrefix: 'optk', key: 'optk_abc', createdAt: '2026-01-01' };
            mockOkResponse(body);
            const result = await client.createApiKey('ci');
            expect(result).toEqual(body);
        });

        it('throws error with message from API on failure', async () => {
            mockErrorResponse(400, { message: 'Invalid name' });
            await expect(client.createApiKey('')).rejects.toThrow('Invalid name');
        });
    });

    describe('listApiKeys', () => {
        it('sends GET to /api/keys with Authorization header', async () => {
            mockOkResponse({ keys: [] });
            await client.listApiKeys();

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/keys',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
                })
            );
        });

        it('returns unwrapped keys array on success', async () => {
            const keys = [{ id: 1, name: 'ci', keyPrefix: 'AjxXAsrG', createdAt: '2026-01-01' }];
            mockOkResponse({ keys });
            const result = await client.listApiKeys();
            expect(result).toEqual(keys);
        });

        it('throws error on failure', async () => {
            mockErrorResponse(500);
            await expect(client.listApiKeys()).rejects.toThrow('API request failed');
        });
    });

    describe('deleteApiKey', () => {
        it('sends DELETE to /api/keys/:id with Authorization header', async () => {
            mockOkResponse({});
            await client.deleteApiKey('k1');

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/keys/k1',
                expect.objectContaining({
                    method: 'DELETE',
                    headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
                })
            );
        });

        it('URL-encodes the id parameter', async () => {
            mockOkResponse({});
            await client.deleteApiKey('key/with special');

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/keys/key%2Fwith%20special',
                expect.anything()
            );
        });

        it('returns void on success', async () => {
            mockOkResponse({});
            const result = await client.deleteApiKey('k1');
            expect(result).toBeUndefined();
        });

        it('throws error with status on failure', async () => {
            mockErrorResponse(404, { message: 'Key not found' });
            try {
                await client.deleteApiKey('bad-id');
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.status).toBe(404);
                expect(err.message).toBe('Key not found');
            }
        });
    });

    describe('getReviewStatus', () => {
        it('sends GET to /api/user/review-status with Authorization header', async () => {
            mockOkResponse({ current: 5, limit: 100, remaining: 95 });
            await client.getReviewStatus();

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/user/review-status',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
                })
            );
        });

        it('returns parsed review status on success', async () => {
            const status = { current: 5, limit: 100, remaining: 95, resetAt: '2026-03-18T00:00:00Z' };
            mockOkResponse(status);
            const result = await client.getReviewStatus();
            expect(result).toEqual(status);
        });

        it('throws error on failure', async () => {
            mockErrorResponse(500);
            await expect(client.getReviewStatus()).rejects.toThrow('API request failed');
        });
    });

    describe('getReviewResult', () => {
        it('GETs /api/review/result/:reviewId with auth', async () => {
            mockOkResponse({ status: 'pending' });
            await client.getReviewResult('apirev_abc');

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/review/result/apirev_abc',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
                })
            );
        });

        it('returns pending while the review runs', async () => {
            mockOkResponse({ status: 'pending' });
            expect(await client.getReviewResult('apirev_abc')).toEqual({ status: 'pending' });
        });

        it('decodes base64 comments on a done result', async () => {
            const gc = Buffer.from('All good').toString('base64');
            const fc = Buffer.from('line 1').toString('base64');
            mockOkResponse({ status: 'done', generalComment: gc, fileComments: [fc], isOptibotInstalled: true });

            expect(await client.getReviewResult('apirev_abc')).toEqual({
                status: 'done',
                generalComment: 'All good',
                fileComments: ['line 1'],
                isOptibotInstalled: true,
            });
        });

        it('returns failed with the error message', async () => {
            mockOkResponse({ status: 'failed', error: 'boom' });
            expect(await client.getReviewResult('apirev_abc')).toEqual({ status: 'failed', error: 'boom' });
        });

        it('returns not_found on a 404', async () => {
            mockErrorResponse(404, { status: 'not_found' });
            expect(await client.getReviewResult('apirev_abc')).toEqual({ status: 'not_found' });
        });

        it('throws on a non-404 error', async () => {
            mockErrorResponse(401, { message: 'Unauthorized' });
            await expect(client.getReviewResult('apirev_abc')).rejects.toThrow('Unauthorized');
        });
    });

    describe('listOrganizations', () => {
        it('sends GET to /client/organizations with Authorization header', async () => {
            mockOkResponse({ organizations: [], currentOrganizationId: 1 });
            await client.listOrganizations();
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/client/organizations',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
                })
            );
        });

        it('returns parsed response', async () => {
            const body = { organizations: [{ id: 1, name: 'Acme' }], currentOrganizationId: 1 };
            mockOkResponse(body);
            expect(await client.listOrganizations()).toEqual(body);
        });

        it('throws on failure', async () => {
            mockErrorResponse(401);
            await expect(client.listOrganizations()).rejects.toThrow();
        });
    });

    describe('rescopeToken', () => {
        it('POSTs the organization id to /client/token/rescope', async () => {
            mockOkResponse({ token: 'new', expiresIn: 7_776_000, organizationId: 42 });
            await client.rescopeToken(42);
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/client/token/rescope',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ organizationId: 42 }),
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key',
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });

        it('throws on failure', async () => {
            mockErrorResponse(403, { message: 'Not a member' });
            await expect(client.rescopeToken(999)).rejects.toThrow('Not a member');
        });
    });

    describe('getSecurityPricing', () => {
        it('GETs /api/security/pricing', async () => {
            mockOkResponse({ markupMultiplier: 1, tiers: {} });
            await client.getSecurityPricing();
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/security/pricing',
                expect.objectContaining({ method: 'GET' }),
            );
        });

        it('throws on failure', async () => {
            mockErrorResponse(500);
            await expect(client.getSecurityPricing()).rejects.toThrow();
        });
    });

    describe('getSecurityUsage', () => {
        it('GETs /api/security/usage', async () => {
            mockOkResponse({ tokensUsed: 0, costUSD: 0, month: 1, year: 2026 });
            await client.getSecurityUsage();
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/security/usage',
                expect.objectContaining({ method: 'GET' }),
            );
        });

        it('throws on failure', async () => {
            mockErrorResponse(500);
            await expect(client.getSecurityUsage()).rejects.toThrow();
        });
    });

    describe('listSecurityIssues', () => {
        it('sends no query string when no params are provided', async () => {
            mockOkResponse({ items: [], totalItems: 0, page: 1, pageSize: 5, totalPages: 0 });
            await client.listSecurityIssues();
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/security/issues',
                expect.anything(),
            );
        });

        it('encodes page, pageSize, and repositoryIds into the query string', async () => {
            mockOkResponse({ items: [], totalItems: 0, page: 2, pageSize: 10, totalPages: 0 });
            await client.listSecurityIssues({ page: 2, pageSize: 10, repositoryIds: [1, 2, 3] });
            const url = fetchMock.mock.calls[0][0];
            expect(url).toContain('page=2');
            expect(url).toContain('pageSize=10');
            expect(url).toContain('repositoryIds=1%2C2%2C3');
        });

        it('omits repositoryIds when the array is empty', async () => {
            mockOkResponse({ items: [], totalItems: 0, page: 1, pageSize: 5, totalPages: 0 });
            await client.listSecurityIssues({ page: 1, repositoryIds: [] });
            const url = fetchMock.mock.calls[0][0];
            expect(url).not.toContain('repositoryIds');
        });
    });

    describe('triggerSecurityScan', () => {
        it('POSTs the body to /api/security/scan without a session id by default', async () => {
            mockOkResponse({ message: 'ok', sessionId: null });
            await client.triggerSecurityScan({ repositoryId: 1 });
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/security/scan',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ repositoryId: 1 }),
                }),
            );
        });

        it('appends the session id to the query string when provided', async () => {
            mockOkResponse({ message: 'ok', sessionId: 'srv' });
            await client.triggerSecurityScan({ repositoryId: 1 }, 'abc/def');
            const url = fetchMock.mock.calls[0][0];
            expect(url).toContain('/api/security/scan?sessionId=abc%2Fdef');
        });
    });

    describe('getSecurityConfig', () => {
        it('GETs /api/organizations/:id/security-configs', async () => {
            mockOkResponse({ config: {} });
            await client.getSecurityConfig(7);
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/organizations/7/security-configs',
                expect.objectContaining({ method: 'GET' }),
            );
        });
    });

    describe('saveSecurityConfig', () => {
        it('PUTs the body to /api/organizations/:id/security-configs', async () => {
            const body = {
                enabled: true, schedule: 'weekly' as const, postAsIssue: false,
                modelTier: 'low' as const, maxBudgetUSD: 1, repositoryIds: [1],
            };
            mockOkResponse({ message: 'Saved', config: body });
            await client.saveSecurityConfig(7, body);
            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/organizations/7/security-configs',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify(body),
                }),
            );
        });
    });

    describe('listRepositoryStats', () => {
        it('returns the array directly when the backend returns an array', async () => {
            mockOkResponse([{ id: 1, name: 'a' }, { id: 2, name: 'b' }] as unknown as Record<string, unknown>);
            const result = await client.listRepositoryStats(7);
            expect(result).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
        });

        it('unwraps { items: [...] } when the backend uses that envelope', async () => {
            mockOkResponse({ items: [{ id: 3, name: 'c' }] });
            const result = await client.listRepositoryStats(7);
            expect(result).toEqual([{ id: 3, name: 'c' }]);
        });

        it('returns an empty array for unexpected shapes', async () => {
            mockOkResponse({ random: 'shape' });
            const result = await client.listRepositoryStats(7);
            expect(result).toEqual([]);
        });

        it('throws on failure', async () => {
            mockErrorResponse(500);
            await expect(client.listRepositoryStats(7)).rejects.toThrow();
        });
    });
});
