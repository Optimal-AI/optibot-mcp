import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadConfig = vi.fn();
const mockWriteConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockListOrganizations = vi.fn();
const mockSanitizeServerText = vi.fn((s: string) => s);
const mockGetOrgIdFromToken = vi.fn();

// Mock the dynamic `import('open')` inside the login handler so tests can
// drive the post-listen flow without actually launching a browser.
const openMock = vi.hoisted(() => vi.fn());
vi.mock('open', () => ({ default: openMock }));

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
    deleteConfig: (...args: unknown[]) => mockDeleteConfig(...args),
}));

vi.mock('../lib/apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        listOrganizations(...args: unknown[]) { return mockListOrganizations(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    sanitizeServerText: (...args: unknown[]) => mockSanitizeServerText(...(args as [string])),
}));

vi.mock('../lib/jwt.js', () => ({
    getOrganizationIdFromToken: (...args: unknown[]) => mockGetOrgIdFromToken(...args),
}));

import { registerAuthTools, statesMatch, isAllowedHost } from './auth.js';

describe('auth tools', () => {
    let registeredTools: Map<string, (args: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>>;

    beforeEach(() => {
        registeredTools = new Map();
        mockGetOrgIdFromToken.mockReset();
        mockListOrganizations.mockReset();

        const server = {
            tool: vi.fn((...args: unknown[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as (a: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
                registeredTools.set(name, handler);
            }),
        } as unknown as Parameters<typeof registerAuthTools>[0];

        registerAuthTools(server);
    });

    it('registers three auth tools (get_profile removed in 1.3.0)', () => {
        expect(registeredTools.has('login')).toBe(true);
        expect(registeredTools.has('logout')).toBe(true);
        expect(registeredTools.has('check_auth')).toBe(true);
        expect(registeredTools.has('get_profile')).toBe(false);
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
            mockGetOrgIdFromToken.mockReturnValue(null);

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('environment variable');
            expect(result.content[0].text).toContain('optk_tes');
        });

        it('returns config file status when authenticated via file', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockResolvedValue({ apiKey: 'file_key_value' });
            mockGetOrgIdFromToken.mockReturnValue(null);

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('config file');
            expect(result.content[0].text).toContain('file_key');
        });

        it('includes active organization id when present in the token', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockResolvedValue({ apiKey: 'tok' });
            mockGetOrgIdFromToken.mockReturnValue(42);

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Active organization id (from token): 42');
        });

        it('returns not-authenticated message when no auth found', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Not authenticated');
            expect(result.content[0].text).toContain('OPTIBOT_API_KEY');
        });

        it('mentions setup_ci when authenticated', async () => {
            delete process.env.OPTIBOT_API_KEY;
            mockReadConfig.mockResolvedValue({ apiKey: 'tok' });
            mockGetOrgIdFromToken.mockReturnValue(null);

            const handler = registeredTools.get('check_auth')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('setup_ci');
        });
    });

    describe('login', () => {
        const SNAPSHOT_KEYS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_HOME', 'BUILDKITE', 'TRAVIS'] as const;
        const savedCiEnv: Record<string, string | undefined> = {};

        beforeEach(() => {
            for (const k of SNAPSHOT_KEYS) {
                savedCiEnv[k] = process.env[k];
                delete process.env[k];
            }
        });

        afterEach(() => {
            for (const k of SNAPSHOT_KEYS) {
                if (savedCiEnv[k] === undefined) delete process.env[k];
                else process.env[k] = savedCiEnv[k];
            }
        });

        it('refuses to start the browser flow when CI=true', async () => {
            process.env.CI = 'true';
            const handler = registeredTools.get('login')!;
            const result = await handler({});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toMatch(/CI environment detected/i);
            // Should not have attempted to bind to port 8080.
        });

        it('refuses when GITHUB_ACTIONS is set', async () => {
            process.env.GITHUB_ACTIONS = 'true';
            const handler = registeredTools.get('login')!;
            const result = await handler({});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toMatch(/CI environment detected/i);
        });

        // Note: there used to be a "port 8080 already in use" test here, but
        // the login flow now listens on an ephemeral port (server.listen(0)),
        // so port collision is no longer a reachable failure mode.

        it('returns error when browser fails to open', async () => {
            // open() throwing inside the onListening hook should propagate
            // through reject → catch block → isError response.
            openMock.mockRejectedValueOnce(new Error('Cannot open browser'));

            const handler = registeredTools.get('login')!;
            const result = await handler({});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Authentication failed');
            expect(result.content[0].text).toContain('Cannot open browser');
        });

        it('completes happy-path login when callback resolves with valid code+state', async () => {
            // Simulate the browser visit by hitting /callback ourselves once
            // open() is invoked. The real http server on the ephemeral port
            // resolves the OAuth promise and the handler proceeds to token
            // exchange + organization listing (both mocked via fetch).
            openMock.mockImplementationOnce(async (authUrl: string) => {
                const u = new URL(authUrl);
                const port = u.searchParams.get('port');
                const state = u.searchParams.get('state');
                const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=${state}`, {
                    headers: { Host: `127.0.0.1:${port}` },
                });
                // Drain to ensure the server has processed the request.
                await res.text();
            });

            // Capture the real fetch BEFORE spying so the localhost callback
            // request can fall through cleanly. spyOn overwrites globalThis.fetch
            // and does not expose the original via getMockImplementation.
            const realFetch = globalThis.fetch;
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            fetchSpy.mockImplementation(async (input: any, init?: any) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url.includes('/client/token')) {
                    return new Response(JSON.stringify({
                        token: 'jwt.token.value',
                        expiresIn: 90 * 24 * 60 * 60,
                        organizationId: 1,
                        user: { firebaseUserId: 'uid-1', email: 'u@example.com', name: 'U' },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                // Fall through to real fetch for the localhost callback hit.
                return realFetch(input as any, init);
            });

            mockListOrganizations.mockResolvedValueOnce({
                organizations: [{ id: 1, name: 'Acme' }],
                currentOrganizationId: 1,
            });
            mockGetOrgIdFromToken.mockReturnValueOnce(1);
            mockWriteConfig.mockResolvedValueOnce(undefined);

            const handler = registeredTools.get('login')!;
            const result = await handler({});

            expect(result.isError).toBeFalsy();
            expect(result.content[0].text).toContain('Successfully authenticated');
            expect(mockWriteConfig).toHaveBeenCalledWith({ apiKey: 'jwt.token.value' });

            fetchSpy.mockRestore();
        });

    });

    describe('statesMatch', () => {
        it('returns true for identical strings', () => {
            expect(statesMatch('abc123', 'abc123')).toBe(true);
        });

        it('returns false for different strings of equal length', () => {
            expect(statesMatch('abc123', 'xyz789')).toBe(false);
        });

        it('returns false for different lengths (no timingSafeEqual call)', () => {
            // crypto.timingSafeEqual would throw on length mismatch — the
            // helper short-circuits first.
            expect(statesMatch('abc', 'abcd')).toBe(false);
        });

        it('returns true for empty strings', () => {
            expect(statesMatch('', '')).toBe(true);
        });
    });

    describe('isAllowedHost', () => {
        // Port is now ephemeral (assigned by the OS at listen time) so the
        // helper takes the actual port as a second arg. 8080 here is just an
        // arbitrary value that exercises the equality check.
        it('accepts the loopback host on the OAuth port', () => {
            expect(isAllowedHost('127.0.0.1:8080', 8080)).toBe(true);
            expect(isAllowedHost('localhost:8080', 8080)).toBe(true);
        });

        it('rejects loopback on a different port', () => {
            expect(isAllowedHost('127.0.0.1:8081', 8080)).toBe(false);
            expect(isAllowedHost('localhost:9000', 8080)).toBe(false);
        });

        it('rejects external hosts (DNS-rebinding defense)', () => {
            expect(isAllowedHost('evil.example.com:8080', 8080)).toBe(false);
            expect(isAllowedHost('attacker.com', 8080)).toBe(false);
        });

        it('rejects empty / undefined Host header', () => {
            expect(isAllowedHost(undefined, 8080)).toBe(false);
            expect(isAllowedHost('', 8080)).toBe(false);
        });

        it('honors whatever port was actually assigned', () => {
            // OS-assigned port could be anything in the unprivileged range.
            expect(isAllowedHost('127.0.0.1:54321', 54321)).toBe(true);
            expect(isAllowedHost('127.0.0.1:54321', 54322)).toBe(false);
        });
    });
});
