import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockReadConfig = vi.fn();
const mockDeleteConfig = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
    writeConfig: vi.fn(),
    deleteConfig: (...args: any[]) => mockDeleteConfig(...args),
}));

vi.mock('../lib/apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

import { registerAuthTools } from './auth.js';

describe('auth tools', () => {
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

        registerAuthTools(server);
    });

    it('registers three auth tools', () => {
        expect(registeredTools.has('login')).toBe(true);
        expect(registeredTools.has('logout')).toBe(true);
        expect(registeredTools.has('check_auth')).toBe(true);
    });

    describe('logout', () => {
        it('returns success message when credentials deleted', async () => {
            mockDeleteConfig.mockResolvedValue(true);

            const handler = registeredTools.get('logout')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Logged out successfully');
        });

        it('returns already-logged-out message when no credentials found', async () => {
            mockDeleteConfig.mockResolvedValue(false);

            const handler = registeredTools.get('logout')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Already logged out');
        });

        it('returns error on failure', async () => {
            mockDeleteConfig.mockRejectedValue(new Error('Permission denied'));

            const handler = registeredTools.get('logout')!;
            const result = await handler({});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Permission denied');
        });
    });

    describe('check_auth', () => {
        const originalEnv = process.env.OPTIBOT_API_KEY;

        afterEach(() => {
            if (originalEnv === undefined) {
                delete process.env.OPTIBOT_API_KEY;
            } else {
                process.env.OPTIBOT_API_KEY = originalEnv;
            }
        });

        it('returns env var status when OPTIBOT_API_KEY is set', async () => {
            process.env.OPTIBOT_API_KEY = 'optk_test_key_123';

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('environment variable');
            expect(result.content[0].text).toContain('optk_tes');
        });

        it('returns config file status when authenticated via file', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockResolvedValue({ apiKey: 'file_key_value' });

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('config file');
            expect(result.content[0].text).toContain('file_key');
        });

        it('returns not-authenticated message when no auth found', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Not authenticated');
            expect(result.content[0].text).toContain('OPTIBOT_API_KEY');
        });
    });
});
