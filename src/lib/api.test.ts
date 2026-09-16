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

        it('decodes base64 generalComment in response', async () => {
            const encoded = Buffer.from('Good code').toString('base64');
            mockOkResponse({ generalComment: encoded });

            const result = await client.review({ patch: 'x' });
            expect(result.generalComment).toBe('Good code');
        });

        it('decodes base64 fileComments array in response', async () => {
            const c1 = Buffer.from('comment 1').toString('base64');
            const c2 = Buffer.from('comment 2').toString('base64');
            mockOkResponse({ fileComments: [c1, c2] });

            const result = await client.review({ patch: 'x' });
            expect(result.fileComments).toEqual(['comment 1', 'comment 2']);
        });

        it('handles response with no generalComment or fileComments', async () => {
            mockOkResponse({});
            const result = await client.review({ patch: 'x' });
            expect(result.generalComment).toBeUndefined();
            expect(result.fileComments).toBeUndefined();
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

    describe('reviewAgent', () => {
        it('sends POST to /api/review/agent with correct headers', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'diff' });

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/review/agent',
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
            await client.reviewAgent({ patch: 'hello diff' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.patch).toBe(Buffer.from('hello diff').toString('base64'));
        });

        it('base64-encodes file contents when files are provided', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x', files: { 'a.ts': 'file content' } });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files['a.ts']).toBe(Buffer.from('file content').toString('base64'));
        });

        it('base64-encodes relatedFiles when provided', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x', relatedFiles: { 'b.ts': 'related' } });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.relatedFiles['b.ts']).toBe(Buffer.from('related').toString('base64'));
        });

        it('sends localDiagnostics as plain text (not base64)', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x', localDiagnostics: 'tsc: error TS2304' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.localDiagnostics).toBe('tsc: error TS2304');
        });

        it('omits files, relatedFiles, and localDiagnostics when not provided', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files).toBeUndefined();
            expect(callBody.relatedFiles).toBeUndefined();
            expect(callBody.localDiagnostics).toBeUndefined();
        });

        it('omits files and relatedFiles when empty objects', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x', files: {}, relatedFiles: {} });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.files).toBeUndefined();
            expect(callBody.relatedFiles).toBeUndefined();
        });

        it('includes repositoryName when provided', async () => {
            mockOkResponse({});
            await client.reviewAgent({ patch: 'x', repositoryName: 'my-repo' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.repositoryName).toBe('my-repo');
        });

        it('returns the native-JSON response without decoding', async () => {
            const body = {
                status: 'needs_changes',
                reviewPass: false,
                findings: [{ id: 'AF-1', file: 'a.ts', startLine: 1, endLine: 2, inPatch: true, severity: 'blocker', category: 'bug', message: 'plain text', confidence: 8 }],
                summary: 'plain summary',
                reviewCount: { current: 1, limit: 50, remaining: 49 },
                isOptibotInstalled: true,
                meta: { mode: 'agent', durationMs: 1234 },
            };
            mockOkResponse(body);

            const result = await client.reviewAgent({ patch: 'x' });
            expect(result.summary).toBe('plain summary');
            expect(result.findings[0].message).toBe('plain text');
            expect(result.status).toBe('needs_changes');
        });

        it('throws error with message from API when response is not ok', async () => {
            mockErrorResponse(429, { message: 'Agent review limit reached' });
            await expect(client.reviewAgent({ patch: 'x' })).rejects.toThrow('Agent review limit reached');
        });
    });

    describe('submitAgentReview', () => {
        it('sends async:true and reports a 202 as accepted', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 202,
                json: () => Promise.resolve({ reviewId: 'apirev_1', reviewCount: { current: 1, limit: 50, remaining: 49 } }),
            });

            const submission = await client.submitAgentReview({ patch: 'diff' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.async).toBe(true);
            expect(callBody.patch).toBe(Buffer.from('diff').toString('base64'));
            expect(submission).toEqual({
                kind: 'accepted',
                reviewId: 'apirev_1',
                reviewCount: { current: 1, limit: 50, remaining: 49 },
            });
        });

        it('reports an inline 200 as completed, so an older backend still works', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ status: 'looks_good', reviewPass: true, findings: [], summary: 's' }),
            });

            const submission = await client.submitAgentReview({ patch: 'diff' });

            expect(submission.kind).toBe('completed');
            expect(submission).toHaveProperty('review.status', 'looks_good');
        });

        it('base64-encodes related files and sends diagnostics as plain text', async () => {
            fetchMock.mockResolvedValue({ ok: true, status: 202, json: () => Promise.resolve({ reviewId: 'r' }) });

            await client.submitAgentReview({
                patch: 'x',
                relatedFiles: { 'b.ts': 'related' },
                localDiagnostics: 'tsc: error TS2304',
            });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.relatedFiles['b.ts']).toBe(Buffer.from('related').toString('base64'));
            expect(callBody.localDiagnostics).toBe('tsc: error TS2304');
        });

        it('throws on an error response', async () => {
            mockErrorResponse(429, { message: 'Agent review limit reached' });
            await expect(client.submitAgentReview({ patch: 'x' })).rejects.toThrow('Agent review limit reached');
        });
    });

    describe('getAgentReviewResult', () => {
        it('GETs the result endpoint with the id encoded', async () => {
            fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'pending' }) });

            const result = await client.getAgentReviewResult('apirev/1');

            expect(fetchMock).toHaveBeenCalledWith(
                'http://test-api.local/api/review/agent/result/apirev%2F1',
                expect.objectContaining({ method: 'GET' }),
            );
            expect(result).toEqual({ status: 'pending' });
        });

        it('maps a 404 to not_found instead of throwing', async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ status: 'not_found' }) });

            await expect(client.getAgentReviewResult('apirev_1')).resolves.toEqual({ status: 'not_found' });
        });

        it('returns a failed envelope with its errorType', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ status: 'failed', error: 'too big', errorType: 'context_window_exceeded' }),
            });

            await expect(client.getAgentReviewResult('apirev_1')).resolves.toEqual({
                status: 'failed',
                error: 'too big',
                errorType: 'context_window_exceeded',
            });
        });

        it('attaches status to the thrown error', async () => {
            mockErrorResponse(401, { message: 'Unauthorized' });

            try {
                await client.reviewAgent({ patch: 'x' });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.status).toBe(401);
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

    describe('review with reviewSessionId', () => {
        it('includes reviewSessionId in body when provided', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x', reviewSessionId: 'sess-123' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.reviewSessionId).toBe('sess-123');
        });

        it('omits reviewSessionId when not provided', async () => {
            mockOkResponse({});
            await client.review({ patch: 'x' });

            const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(callBody.reviewSessionId).toBeUndefined();
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
