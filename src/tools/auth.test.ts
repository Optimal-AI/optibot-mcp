import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockReadConfig = vi.fn();
const mockWriteConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockGetUserProfile = vi.fn();
const mockGetReviewStatus = vi.fn();
const mockFormatError = vi.fn();
const mockFormatResetTime = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
    writeConfig: (...args: any[]) => mockWriteConfig(...args),
    deleteConfig: (...args: any[]) => mockDeleteConfig(...args),
}));

vi.mock('../lib/apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        getUserProfile(...args: any[]) { return mockGetUserProfile(...args); }
        getReviewStatus(...args: any[]) { return mockGetReviewStatus(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatError: (...args: any[]) => mockFormatError(...args),
    formatResetTime: (...args: any[]) => mockFormatResetTime(...args),
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

    it('registers four auth tools', () => {
        expect(registeredTools.has('login')).toBe(true);
        expect(registeredTools.has('logout')).toBe(true);
        expect(registeredTools.has('check_auth')).toBe(true);
        expect(registeredTools.has('get_profile')).toBe(true);
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

    describe('get_profile', () => {
        it('returns profile and review quota on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetUserProfile.mockResolvedValue({ firebaseUserId: 'u1', email: 'a@b.com', name: 'Alice' });
            mockGetReviewStatus.mockResolvedValue({ current: 5, limit: 100, remaining: 95 });

            const handler = registeredTools.get('get_profile')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Email: a@b.com');
            expect(result.content[0].text).toContain('Name: Alice');
            expect(result.content[0].text).toContain('Used: 5 / 100');
            expect(result.content[0].text).toContain('Remaining: 95');
        });

        it('omits name when not present', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetUserProfile.mockResolvedValue({ firebaseUserId: 'u1', email: 'a@b.com' });
            mockGetReviewStatus.mockResolvedValue({ current: 0, limit: 10, remaining: 10 });

            const handler = registeredTools.get('get_profile')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Email: a@b.com');
            expect(result.content[0].text).not.toContain('Name:');
        });

        it('includes reset time when present', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetUserProfile.mockResolvedValue({ firebaseUserId: 'u1', email: 'a@b.com' });
            mockGetReviewStatus.mockResolvedValue({ current: 5, limit: 100, remaining: 95, resetAt: '2026-03-18T00:00:00Z' });
            mockFormatResetTime.mockReturnValue('in 6h 30m');

            const handler = registeredTools.get('get_profile')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Resets: in 6h 30m');
        });

        it('omits reset time when not present', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetUserProfile.mockResolvedValue({ firebaseUserId: 'u1', email: 'a@b.com' });
            mockGetReviewStatus.mockResolvedValue({ current: 0, limit: 10, remaining: 10 });

            const handler = registeredTools.get('get_profile')!;
            const result = await handler({});

            expect(result.content[0].text).not.toContain('Resets:');
        });

        it('returns error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));
            mockFormatError.mockReturnValue('Auth error');

            const handler = registeredTools.get('get_profile')!;
            const result = await handler({});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Auth error');
        });
    });

    describe('login', () => {
        it('returns error when local server fails to start', async () => {
            // login handler starts an HTTP server on port 8080
            // If port is already in use, it should return an error
            const handler = registeredTools.get('login')!;

            // Mock the http.createServer to simulate port conflict
            const http = await import('http');
            const blockingServer = http.createServer();
            await new Promise<void>((resolve) => {
                blockingServer.listen(8080, '127.0.0.1', () => resolve());
            });

            try {
                const result = await handler({});
                expect(result.isError).toBe(true);
                expect(result.content[0].text).toContain('Authentication failed');
            } finally {
                blockingServer.close();
            }
        });
    });
});
