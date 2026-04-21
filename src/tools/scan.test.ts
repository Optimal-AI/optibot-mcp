import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadConfig = vi.fn();
const mockListOrganizations = vi.fn();
const mockListRepositoryStats = vi.fn();
const mockTriggerSecurityScan = vi.fn();
const mockListSecurityIssues = vi.fn();
const mockGetSecurityUsage = vi.fn();
const mockGetSecurityPricing = vi.fn();
const mockGetSecurityConfig = vi.fn();
const mockSaveSecurityConfig = vi.fn();
const mockGetOrgIdFromToken = vi.fn();
const mockStartSession = vi.fn(async () => 'test-session-id');
const mockEndSession = vi.fn();
const mockWaitForScanCompletion = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        listOrganizations(...args: unknown[]) { return mockListOrganizations(...args); }
        listRepositoryStats(...args: unknown[]) { return mockListRepositoryStats(...args); }
        triggerSecurityScan(...args: unknown[]) { return mockTriggerSecurityScan(...args); }
        listSecurityIssues(...args: unknown[]) { return mockListSecurityIssues(...args); }
        getSecurityUsage(...args: unknown[]) { return mockGetSecurityUsage(...args); }
        getSecurityPricing(...args: unknown[]) { return mockGetSecurityPricing(...args); }
        getSecurityConfig(...args: unknown[]) { return mockGetSecurityConfig(...args); }
        saveSecurityConfig(...args: unknown[]) { return mockSaveSecurityConfig(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    sanitizeServerText: (s: string) => s,
}));

vi.mock('../lib/jwt.js', () => ({
    getOrganizationIdFromToken: (...args: unknown[]) => mockGetOrgIdFromToken(...args),
}));

vi.mock('../lib/scanProgress.js', () => ({
    SecurityScanProgressService: class {
        startSession(...args: unknown[]) { return mockStartSession(...args); }
        endSession(...args: unknown[]) { return mockEndSession(...args); }
    },
}));

vi.mock('../lib/scanPoller.js', () => ({
    waitForScanCompletion: (...args: unknown[]) => mockWaitForScanCompletion(...args),
}));

import { registerScanTools } from './scan.js';

type ToolHandler = (args: unknown, extra?: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;

describe('scan tools', () => {
    let registered: Map<string, ToolHandler>;

    beforeEach(() => {
        registered = new Map();
        mockReadConfig.mockReset();
        mockListOrganizations.mockReset();
        mockListRepositoryStats.mockReset();
        mockTriggerSecurityScan.mockReset();
        mockListSecurityIssues.mockReset();
        mockGetSecurityUsage.mockReset();
        mockGetSecurityPricing.mockReset();
        mockGetSecurityConfig.mockReset();
        mockSaveSecurityConfig.mockReset();
        mockGetOrgIdFromToken.mockReset();
        mockWaitForScanCompletion.mockReset();

        // Default: assume an authenticated user on org 7.
        mockReadConfig.mockResolvedValue({ apiKey: 'k' });
        mockGetOrgIdFromToken.mockReturnValue(7);

        const server = {
            tool: vi.fn((...args: unknown[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as ToolHandler;
                registered.set(name, handler);
            }),
        } as unknown as Parameters<typeof registerScanTools>[0];

        registerScanTools(server);
    });

    it('registers all scan tools', () => {
        const names = [
            'trigger_security_scan',
            'list_security_scans',
            'get_security_scan',
            'get_security_usage',
            'get_security_pricing',
            'list_scannable_repos',
            'get_security_config',
            'update_security_config',
        ];
        for (const n of names) {
            expect(registered.has(n)).toBe(true);
        }
    });

    describe('authentication', () => {
        it('returns a structured error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated.'));
            const result = await registered.get('get_security_usage')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Not authenticated');
        });

        it('falls back to listOrganizations when the JWT claim is missing', async () => {
            mockGetOrgIdFromToken.mockReturnValue(null);
            mockListOrganizations.mockResolvedValue({ organizations: [], currentOrganizationId: 99 });
            mockGetSecurityUsage.mockResolvedValue({ tokensUsed: 0, costUSD: 0, month: 4, year: 2026 });

            await registered.get('get_security_usage')!({}, {});
            expect(mockListOrganizations).toHaveBeenCalled();
        });
    });

    describe('get_security_usage', () => {
        it('renders monthly usage', async () => {
            mockGetSecurityUsage.mockResolvedValue({ tokensUsed: 12345, costUSD: 1.23, month: 4, year: 2026 });
            const result = await registered.get('get_security_usage')!({}, {});
            expect(result.content[0].text).toContain('12,345');
            expect(result.content[0].text).toContain('$1.2300');
            expect(result.content[0].text).toContain('4/2026');
        });
    });

    describe('get_security_pricing', () => {
        it('renders all three tiers with markup', async () => {
            mockGetSecurityPricing.mockResolvedValue({
                markupMultiplier: 1.3,
                tiers: {
                    low: { inputCostPer1M: 1, outputCostPer1M: 2, cacheReadCostPer1M: 0.1, cacheWriteCostPer1M: 0.2 },
                    medium: { inputCostPer1M: 3, outputCostPer1M: 4, cacheReadCostPer1M: 0.3, cacheWriteCostPer1M: 0.4 },
                    high: { inputCostPer1M: 5, outputCostPer1M: 6, cacheReadCostPer1M: 0.5, cacheWriteCostPer1M: 0.6 },
                },
            });
            const result = await registered.get('get_security_pricing')!({}, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('1.3x');
            expect(text).toContain('## low tier');
            expect(text).toContain('## medium tier');
            expect(text).toContain('## high tier');
        });
    });

    describe('list_scannable_repos', () => {
        it('lists repositories with ids', async () => {
            mockListRepositoryStats.mockResolvedValue([
                { id: 1, name: 'repo-a', fullName: 'org/repo-a' },
                { id: 2, name: 'repo-b' },
            ]);
            const result = await registered.get('list_scannable_repos')!({}, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('org/repo-a');
            expect(text).toContain('(id: 1)');
            expect(text).toContain('repo-b');
            expect(text).toContain('(id: 2)');
        });

        it('handles an empty list', async () => {
            mockListRepositoryStats.mockResolvedValue([]);
            const result = await registered.get('list_scannable_repos')!({}, {});
            expect(result.content[0].text).toContain('No repositories available');
        });
    });

    describe('list_security_scans', () => {
        it('formats scans with repo labels', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 1, name: 'repo-a' }]);
            mockListSecurityIssues.mockResolvedValue({
                items: [{
                    id: 10, repositoryId: 1, status: 'completed', issueCount: 3,
                    severity: null, content: null, tokensUsed: 100, costUSD: 0.5,
                    modelTier: 'low', externalIssueUrl: null, scanDate: '2026-04-21', createdAt: '2026-04-21T10:00:00Z',
                }],
                totalItems: 1, page: 1, pageSize: 5, totalPages: 1,
            });
            const result = await registered.get('list_security_scans')!({}, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('#10');
            expect(text).toContain('repo-a');
            expect(text).toContain('3 issues');
        });

        it('returns a friendly message when no scans exist', async () => {
            mockListRepositoryStats.mockResolvedValue([]);
            mockListSecurityIssues.mockResolvedValue({ items: [], totalItems: 0, page: 1, pageSize: 5, totalPages: 0 });
            const result = await registered.get('list_security_scans')!({}, {});
            expect(result.content[0].text).toContain('No security scans found');
        });
    });

    describe('get_security_scan', () => {
        it('fetches a scan by id through pagination', async () => {
            mockListSecurityIssues
                .mockResolvedValueOnce({
                    items: [{ id: 1, repositoryId: 5, status: 'completed', issueCount: 0, severity: null, content: null, tokensUsed: 0, costUSD: 0, modelTier: null, externalIssueUrl: null, scanDate: '2026-04-20', createdAt: '2026-04-20T00:00:00Z' }],
                    totalItems: 2, page: 1, pageSize: 50, totalPages: 2,
                })
                .mockResolvedValueOnce({
                    items: [{ id: 42, repositoryId: 5, status: 'completed', issueCount: 2, severity: { high: 2 }, content: '# Report', tokensUsed: 1000, costUSD: 0.1, modelTier: 'low', externalIssueUrl: null, scanDate: '2026-04-21', createdAt: '2026-04-21T00:00:00Z' }],
                    totalItems: 2, page: 2, pageSize: 50, totalPages: 2,
                });

            const result = await registered.get('get_security_scan')!({ scanId: 42 }, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('Scan #42');
            expect(text).toContain('high: 2');
            expect(text).toContain('# Report');
        });

        it('returns not_found when the scan id does not exist', async () => {
            mockListSecurityIssues.mockResolvedValue({
                items: [], totalItems: 0, page: 1, pageSize: 50, totalPages: 0,
            });
            const result = await registered.get('get_security_scan')!({ scanId: 999 }, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('not found');
        });
    });

    describe('trigger_security_scan', () => {
        it('rejects when neither repositoryId nor name is provided', async () => {
            const result = await registered.get('trigger_security_scan')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('repositoryId or name');
        });

        it('runs the full scan flow and returns the completed result', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 5, name: 'repo-a', fullName: 'org/repo-a' }]);
            mockTriggerSecurityScan.mockResolvedValue({ message: 'ok', sessionId: 'srv-sess' });
            mockWaitForScanCompletion.mockResolvedValue({
                status: 'completed',
                result: {
                    id: 99, repositoryId: 5, status: 'completed', issueCount: 1,
                    severity: { low: 1 }, content: '# Found one thing', tokensUsed: 500, costUSD: 0.25,
                    modelTier: 'medium', externalIssueUrl: null, scanDate: '2026-04-21', createdAt: '2026-04-21T12:00:00Z',
                },
            });

            const result = await registered.get('trigger_security_scan')!({ name: 'repo-a', modelTier: 'medium' }, { sendNotification: () => {} });
            const text = result.content[0].text ?? '';
            expect(text).toContain('Scan #99');
            expect(text).toContain('# Found one thing');

            // Verify we passed the correct body and resolved session id
            expect(mockTriggerSecurityScan).toHaveBeenCalledWith(
                { repositoryId: 5, modelTier: 'medium' },
                'test-session-id',
            );
        });

        it('returns a still_running handoff on timeout', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 5, name: 'repo-a' }]);
            mockTriggerSecurityScan.mockResolvedValue({ message: 'ok', sessionId: 'srv-sess' });
            mockWaitForScanCompletion.mockResolvedValue({ status: 'timeout' });

            const result = await registered.get('trigger_security_scan')!({ repositoryId: 5, timeoutSeconds: 30 }, { sendNotification: () => {} });
            const text = result.content[0].text ?? '';
            expect(text).toContain('still_running');
            expect(text).toContain('30s');
            expect(result.isError).toBeUndefined();
        });
    });

    describe('update_security_config', () => {
        it('merges current config with user input and saves', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: false, schedule: 'weekly', customCron: null, postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [1, 2], lastScanDate: null,
                },
            });
            mockSaveSecurityConfig.mockResolvedValue({
                message: 'Saved',
                config: {
                    enabled: true, schedule: 'weekly', customCron: null, postAsIssue: false,
                    modelTier: 'high', maxBudgetUSD: 1, selectedRepositoryIds: [1, 2], lastScanDate: null,
                },
            });

            await registered.get('update_security_config')!({ enabled: true, modelTier: 'high' }, {});

            expect(mockSaveSecurityConfig).toHaveBeenCalledWith(7, expect.objectContaining({
                enabled: true,
                schedule: 'weekly',
                modelTier: 'high',
                maxBudgetUSD: 1,
                repositoryIds: [1, 2],
            }));
        });

        it('requires customCron when schedule is custom', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: true, schedule: 'weekly', customCron: null, postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [], lastScanDate: null,
                },
            });

            const result = await registered.get('update_security_config')!({ schedule: 'custom' }, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('customCron');
            expect(mockSaveSecurityConfig).not.toHaveBeenCalled();
        });
    });

    describe('get_security_config', () => {
        it('formats config with repo labels', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: true, schedule: 'monthly', customCron: null, postAsIssue: true,
                    modelTier: 'medium', maxBudgetUSD: 5, selectedRepositoryIds: [1],
                    lastScanDate: '2026-04-01',
                },
            });
            mockListRepositoryStats.mockResolvedValue([{ id: 1, name: 'repo-a' }]);

            const result = await registered.get('get_security_config')!({}, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('Enabled: yes');
            expect(text).toContain('Schedule: monthly');
            expect(text).toContain('$5.00');
            expect(text).toContain('repo-a (id: 1)');
            expect(text).toContain('Last scheduled scan: 2026-04-01');
        });

        it('renders custom cron and empty repo list', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: false, schedule: 'custom', customCron: '0 3 * * 1', postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [],
                    lastScanDate: null,
                },
            });
            mockListRepositoryStats.mockResolvedValue([]);

            const result = await registered.get('get_security_config')!({}, {});
            const text = result.content[0].text ?? '';
            expect(text).toContain('Enabled: no');
            expect(text).toContain('custom (0 3 * * 1)');
            expect(text).toContain('(none)');
            expect(text).not.toContain('Last scheduled scan');
        });

        it('returns a structured error when the backend fails', async () => {
            mockGetSecurityConfig.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
            mockListRepositoryStats.mockResolvedValue([]);
            const result = await registered.get('get_security_config')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });
    });

    describe('extra trigger_security_scan branches', () => {
        it('returns an error when the repo name is ambiguous', async () => {
            mockListRepositoryStats.mockResolvedValue([
                { id: 1, name: 'dup' },
                { id: 2, name: 'dup' },
            ]);
            const result = await registered.get('trigger_security_scan')!(
                { name: 'dup' }, { sendNotification: () => {} },
            );
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Ambiguous');
        });

        it('returns an error when the repo id does not exist in the active org', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 1, name: 'a' }]);
            const result = await registered.get('trigger_security_scan')!(
                { repositoryId: 99 }, { sendNotification: () => {} },
            );
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('not found in the active organization');
        });

        it('surfaces a 402 insufficient-credits error with the top-up URL', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 5, name: 'repo-a' }]);
            mockTriggerSecurityScan.mockRejectedValue(Object.assign(new Error('402'), {
                status: 402,
                data: {
                    error: 'Insufficient credits',
                    currentBalanceUSD: 0.05,
                    requiredUSD: 2.00,
                    topUpUrl: 'https://example.com/top-up',
                },
            }));

            const result = await registered.get('trigger_security_scan')!(
                { repositoryId: 5 }, { sendNotification: () => {} },
            );
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Insufficient AI credits');
            expect(result.content[0].text).toContain('https://example.com/top-up');
        });

        it('forwards postAsIssue when set', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 5, name: 'repo-a' }]);
            mockTriggerSecurityScan.mockResolvedValue({ message: 'ok', sessionId: 's' });
            mockWaitForScanCompletion.mockResolvedValue({
                status: 'completed',
                result: {
                    id: 1, repositoryId: 5, status: 'completed', issueCount: 0,
                    severity: null, content: null, tokensUsed: 0, costUSD: 0,
                    modelTier: 'low', externalIssueUrl: 'https://example.com/issue/1', scanDate: '2026-04-21', createdAt: '2026-04-21T00:00:00Z',
                },
            });

            await registered.get('trigger_security_scan')!(
                { repositoryId: 5, postAsIssue: true, maxBudgetUSD: 3 },
                { sendNotification: () => {} },
            );
            expect(mockTriggerSecurityScan).toHaveBeenCalledWith(
                { repositoryId: 5, postAsIssue: true, maxBudgetUSD: 3 },
                'test-session-id',
            );
        });

        it('marks the result as error when the scan reports status=failed', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 5, name: 'repo-a' }]);
            mockTriggerSecurityScan.mockResolvedValue({ message: 'ok', sessionId: 's' });
            mockWaitForScanCompletion.mockResolvedValue({
                status: 'completed',
                result: {
                    id: 2, repositoryId: 5, status: 'failed', issueCount: 0,
                    severity: null, content: 'scan failed', tokensUsed: 0, costUSD: 0,
                    modelTier: 'low', externalIssueUrl: null, scanDate: '2026-04-21', createdAt: '2026-04-21T00:00:00Z',
                },
            });

            const result = await registered.get('trigger_security_scan')!(
                { repositoryId: 5 }, { sendNotification: () => {} },
            );
            expect(result.isError).toBe(true);
        });
    });

    describe('extra list_security_scans branches', () => {
        it('filters by repo when a repositoryId is provided', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 7, name: 'repo-z' }]);
            mockListSecurityIssues.mockResolvedValue({
                items: [],
                totalItems: 0, page: 1, pageSize: 5, totalPages: 0,
            });

            await registered.get('list_security_scans')!({ repositoryId: 7 }, {});
            expect(mockListSecurityIssues).toHaveBeenCalledWith(expect.objectContaining({
                repositoryIds: [7],
            }));
        });

        it('still returns a list when repo-labels stats call fails', async () => {
            mockListRepositoryStats.mockRejectedValue(new Error('stats down'));
            mockListSecurityIssues.mockResolvedValue({
                items: [{
                    id: 10, repositoryId: 1, status: 'completed', issueCount: 1,
                    severity: null, content: null, tokensUsed: 1, costUSD: 0.01,
                    modelTier: null, externalIssueUrl: null, scanDate: '2026-04-21', createdAt: '2026-04-21T00:00:00Z',
                }],
                totalItems: 1, page: 1, pageSize: 5, totalPages: 1,
            });

            const result = await registered.get('list_security_scans')!({}, {});
            expect(result.content[0].text).toContain('#10');
            expect(result.content[0].text).toContain('repo 1'); // fallback label
        });
    });

    describe('error propagation from read tools', () => {
        it('get_security_usage surfaces backend errors', async () => {
            mockGetSecurityUsage.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
            const result = await registered.get('get_security_usage')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (503)');
        });

        it('get_security_pricing surfaces backend errors', async () => {
            mockGetSecurityPricing.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
            const result = await registered.get('get_security_pricing')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });

        it('list_scannable_repos surfaces backend errors', async () => {
            mockListRepositoryStats.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
            const result = await registered.get('list_scannable_repos')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });

        it('list_security_scans surfaces backend errors', async () => {
            mockListRepositoryStats.mockResolvedValue([]);
            mockListSecurityIssues.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
            const result = await registered.get('list_security_scans')!({}, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });

        it('get_security_scan surfaces backend errors', async () => {
            mockListSecurityIssues.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
            const result = await registered.get('get_security_scan')!({ scanId: 1 }, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });

        it('list_security_scans rejects an unknown repo filter', async () => {
            mockListRepositoryStats.mockResolvedValue([{ id: 1, name: 'exists' }]);
            const result = await registered.get('list_security_scans')!({ name: 'missing' }, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('not found');
        });
    });

    describe('extra update_security_config branches', () => {
        it('preserves the existing customCron when only switching to custom schedule', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: true, schedule: 'weekly', customCron: '0 0 * * *', postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [], lastScanDate: null,
                },
            });
            mockSaveSecurityConfig.mockResolvedValue({
                message: 'Saved',
                config: {
                    enabled: true, schedule: 'custom', customCron: '0 0 * * *', postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [], lastScanDate: null,
                },
            });

            await registered.get('update_security_config')!({ schedule: 'custom' }, {});
            expect(mockSaveSecurityConfig).toHaveBeenCalledWith(7, expect.objectContaining({
                schedule: 'custom',
                customCron: '0 0 * * *',
            }));
        });

        it('surfaces backend failures from saveSecurityConfig', async () => {
            mockGetSecurityConfig.mockResolvedValue({
                config: {
                    enabled: true, schedule: 'weekly', customCron: null, postAsIssue: false,
                    modelTier: 'low', maxBudgetUSD: 1, selectedRepositoryIds: [], lastScanDate: null,
                },
            });
            mockSaveSecurityConfig.mockRejectedValue(Object.assign(new Error('save failed'), {
                status: 500,
                data: { error: 'db down' },
            }));

            const result = await registered.get('update_security_config')!({ enabled: false }, {});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Server error (500)');
        });
    });
});
