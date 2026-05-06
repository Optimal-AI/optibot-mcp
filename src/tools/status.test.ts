import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadConfig = vi.fn();
const mockGetReviewStatus = vi.fn();
const mockListOrganizations = vi.fn();
const mockGetOrgIdFromToken = vi.fn();
const mockFormatError = vi.fn((err: unknown) => `formatted: ${(err as Error).message}`);
const mockFormatResetTime = vi.fn();
const mockSanitize = vi.fn((s: string) => s);

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        getReviewStatus(...args: unknown[]) { return mockGetReviewStatus(...args); }
        listOrganizations(...args: unknown[]) { return mockListOrganizations(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatError: (...args: unknown[]) => mockFormatError(...args),
    formatResetTime: (...args: unknown[]) => mockFormatResetTime(...args),
    sanitizeServerText: (...args: unknown[]) => mockSanitize(...(args as [string])),
}));

vi.mock('../lib/jwt.js', () => ({
    getOrganizationIdFromToken: (...args: unknown[]) => mockGetOrgIdFromToken(...args),
}));

import { registerStatusTool } from './status.js';

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;

describe('status tool', () => {
    let registered: Map<string, ToolHandler>;
    const originalEnv = process.env.OPTIBOT_API_KEY;

    beforeEach(() => {
        registered = new Map();
        mockReadConfig.mockReset();
        mockGetReviewStatus.mockReset();
        mockListOrganizations.mockReset();
        mockGetOrgIdFromToken.mockReset();
        mockFormatResetTime.mockReset();

        const server = {
            tool: vi.fn((...args: unknown[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as ToolHandler;
                registered.set(name, handler);
            }),
        } as unknown as Parameters<typeof registerStatusTool>[0];

        registerStatusTool(server);
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OPTIBOT_API_KEY;
        } else {
            process.env.OPTIBOT_API_KEY = originalEnv;
        }
    });

    it('registers the get_status tool', () => {
        expect(registered.has('get_status')).toBe(true);
    });

    it('reports env var authentication method when OPTIBOT_API_KEY is set', async () => {
        process.env.OPTIBOT_API_KEY = 'optk_env_key_abc';
        mockReadConfig.mockResolvedValue({ apiKey: 'optk_env_key_abc' });
        mockListOrganizations.mockResolvedValue({ organizations: [], currentOrganizationId: 0 });
        mockGetReviewStatus.mockResolvedValue({ current: 1, limit: 10, remaining: 9 });
        mockGetOrgIdFromToken.mockReturnValue(null);

        const result = await registered.get('get_status')!({});
        expect(result.content[0].text).toContain('OPTIBOT_API_KEY environment variable');
    });

    it('reports config-file authentication when env var not set', async () => {
        delete process.env.OPTIBOT_API_KEY;
        mockReadConfig.mockResolvedValue({ apiKey: 'file_key_abc123' });
        mockListOrganizations.mockResolvedValue({
            organizations: [{ id: 1, name: 'Acme', role: 'owner' }],
            currentOrganizationId: 1,
        });
        mockGetReviewStatus.mockResolvedValue({ current: 3, limit: 100, remaining: 97 });
        mockGetOrgIdFromToken.mockReturnValue(1);

        const result = await registered.get('get_status')!({});
        const text = result.content[0].text ?? '';

        expect(text).toContain('config file');
        expect(text).toContain('Active: Acme');
        expect(text).toContain('Role: owner');
        expect(text).toContain('Used: 3 / 100');
    });

    it('prefers the JWT claim over currentOrganizationId for the active org', async () => {
        delete process.env.OPTIBOT_API_KEY;
        mockReadConfig.mockResolvedValue({ apiKey: 'k' });
        mockListOrganizations.mockResolvedValue({
            organizations: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
            currentOrganizationId: 1,
        });
        mockGetReviewStatus.mockResolvedValue({ current: 0, limit: 10, remaining: 10 });
        mockGetOrgIdFromToken.mockReturnValue(2);

        const result = await registered.get('get_status')!({});
        expect(result.content[0].text).toContain('Active: Two');
    });

    it('survives partial failures — shows what succeeded', async () => {
        delete process.env.OPTIBOT_API_KEY;
        mockReadConfig.mockResolvedValue({ apiKey: 'k' });
        mockListOrganizations.mockResolvedValue({
            organizations: [{ id: 1, name: 'Acme' }],
            currentOrganizationId: 1,
        });
        mockGetReviewStatus.mockRejectedValue(new Error('quota unavailable'));
        mockGetOrgIdFromToken.mockReturnValue(1);

        const result = await registered.get('get_status')!({});
        const text = result.content[0].text ?? '';

        expect(text).toContain('Active: Acme');
        expect(text).not.toContain('Review Quota'); // quota section skipped
    });

    it('returns a formatted error when not authenticated', async () => {
        delete process.env.OPTIBOT_API_KEY;
        mockReadConfig.mockRejectedValue(new Error('Not authenticated'));

        const result = await registered.get('get_status')!({});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('formatted: Not authenticated');
    });
});
