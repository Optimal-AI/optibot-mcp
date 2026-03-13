import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockReadConfig = vi.fn();
const mockCreateApiKey = vi.fn();
const mockListApiKeys = vi.fn();
const mockDeleteApiKey = vi.fn();
const mockFormatError = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        createApiKey(...args: any[]) { return mockCreateApiKey(...args); }
        listApiKeys(...args: any[]) { return mockListApiKeys(...args); }
        deleteApiKey(...args: any[]) { return mockDeleteApiKey(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatError: (...args: any[]) => mockFormatError(...args),
}));

import { registerApiKeyTools } from './apikey.js';

describe('apikey tools', () => {
    let registeredTools: Map<string, Function>;

    beforeEach(() => {
        registeredTools = new Map();

        const server = {
            tool: vi.fn((...args: any[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as Function;
                registeredTools.set(name, handler);
            }),
        } as any;

        registerApiKeyTools(server);
    });

    it('registers three apikey tools', () => {
        expect(registeredTools.has('create_api_key')).toBe(true);
        expect(registeredTools.has('list_api_keys')).toBe(true);
        expect(registeredTools.has('delete_api_key')).toBe(true);
    });

    describe('create_api_key', () => {
        it('returns key info on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockCreateApiKey.mockResolvedValue({
                id: 1, name: 'ci', keyPrefix: 'optk', key: 'optk_abc123', createdAt: '2026-01-01',
            });

            const handler = registeredTools.get('create_api_key')!;
            const result = await handler({ name: 'ci' });

            expect(result.content[0].text).toContain('API key created successfully');
            expect(result.content[0].text).toContain('optk_abc123');
            expect(result.content[0].text).toContain('will not be shown again');
        });

        it('returns error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));
            mockFormatError.mockReturnValue('Auth error');

            const handler = registeredTools.get('create_api_key')!;
            const result = await handler({ name: 'ci' });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Auth error');
        });
    });

    describe('list_api_keys', () => {
        it('returns formatted key list on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockListApiKeys.mockResolvedValue([
                { id: 1, name: 'ci', keyPrefix: 'optk_abc', createdAt: '2026-01-01', lastUsedAt: '2026-01-02' },
                { id: 2, name: 'staging', keyPrefix: 'optk_def', createdAt: '2026-01-03' },
            ]);

            const handler = registeredTools.get('list_api_keys')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('API Keys (2)');
            expect(result.content[0].text).toContain('ci');
            expect(result.content[0].text).toContain('staging');
            expect(result.content[0].text).toContain('Last used');
        });

        it('returns message when no keys found', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockListApiKeys.mockResolvedValue([]);

            const handler = registeredTools.get('list_api_keys')!;
            const result = await handler({});

            expect(result.content[0].text).toBe('No API keys found.');
        });

        it('returns error on failure', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockListApiKeys.mockRejectedValue(new Error('Server error'));
            mockFormatError.mockReturnValue('Server error');

            const handler = registeredTools.get('list_api_keys')!;
            const result = await handler({});

            expect(result.isError).toBe(true);
        });
    });

    describe('delete_api_key', () => {
        it('returns success message on deletion', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockDeleteApiKey.mockResolvedValue(undefined);

            const handler = registeredTools.get('delete_api_key')!;
            const result = await handler({ id: '42' });

            expect(result.content[0].text).toContain('42');
            expect(result.content[0].text).toContain('deleted successfully');
        });

        it('returns error on failure', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockDeleteApiKey.mockRejectedValue({ status: 404, message: 'Key not found' });
            mockFormatError.mockReturnValue('Key not found');

            const handler = registeredTools.get('delete_api_key')!;
            const result = await handler({ id: 'bad-id' });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Key not found');
        });
    });
});
