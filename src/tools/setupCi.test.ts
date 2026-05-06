import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadConfig = vi.fn();
const mockCreateApiKey = vi.fn();
const mockFormatError = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        createApiKey(...args: any[]) { return mockCreateApiKey(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatError: (...args: any[]) => mockFormatError(...args),
    sanitizeServerText: (s: string) => s,
}));

import { registerSetupCiTool, handleSetupCi } from './setupCi.js';

const SNAPSHOT_KEYS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_HOME', 'BUILDKITE', 'TRAVIS'] as const;

describe('setup_ci tool', () => {
    let savedEnv: Record<string, string | undefined>;
    let registeredTools: Map<string, Function>;

    beforeEach(() => {
        savedEnv = {};
        for (const k of SNAPSHOT_KEYS) {
            savedEnv[k] = process.env[k];
            delete process.env[k];
        }
        mockReadConfig.mockReset();
        mockCreateApiKey.mockReset();
        mockFormatError.mockReset();
        mockFormatError.mockReturnValue('formatted error');

        registeredTools = new Map();
        const server = {
            tool: vi.fn((...args: any[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as Function;
                registeredTools.set(name, handler);
            }),
        } as any;
        registerSetupCiTool(server);
    });

    afterEach(() => {
        for (const k of SNAPSHOT_KEYS) {
            if (savedEnv[k] === undefined) delete process.env[k];
            else process.env[k] = savedEnv[k];
        }
    });

    it('registers setup_ci tool', () => {
        expect(registeredTools.has('setup_ci')).toBe(true);
    });

    it('returns a not-authenticated structured response when readConfig fails', async () => {
        mockReadConfig.mockRejectedValue(new Error('not auth'));
        const result = await handleSetupCi({ name: 'ci' });
        expect(result.isError).toBeTruthy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(/not authenticated/i);
    });

    it('refuses inside a CI environment', async () => {
        process.env.CI = 'true';
        mockReadConfig.mockResolvedValue({ apiKey: 'jwt' });
        const result = await handleSetupCi({ name: 'ci' });
        expect(result.isError).toBeTruthy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(/CI environment detected/i);
        expect(mockCreateApiKey).not.toHaveBeenCalled();
    });

    it('refuses CI environments before checking auth (CI guard runs first)', async () => {
        // Unauthenticated AND in CI → should report CI, not "Not authenticated".
        // This is the user-visible difference: a single round-trip refusal
        // instead of forcing the user to log in just to hit the CI guard next.
        process.env.CI = 'true';
        mockReadConfig.mockRejectedValue(new Error('not auth'));
        const result = await handleSetupCi({ name: 'ci' });
        expect(result.isError).toBeTruthy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(/CI environment detected/i);
        expect(text).not.toMatch(/Not authenticated/i);
        expect(mockReadConfig).not.toHaveBeenCalled();
    });

    it('mints a key with default name "ci" and returns key + snippets', async () => {
        mockReadConfig.mockResolvedValue({ apiKey: 'jwt' });
        mockCreateApiKey.mockResolvedValue({
            id: 1, name: 'ci', keyPrefix: 'optk_x', key: 'optk_real', createdAt: '2026-04-30',
        });
        const result = await handleSetupCi({});
        expect(mockCreateApiKey).toHaveBeenCalledWith('ci');
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('optk_real');
        expect(text).toContain('export OPTIBOT_API_KEY=optk_real');
        expect(text).toMatch(/secret store as OPTIBOT_API_KEY/);
        // Snippets removed in this release — must not print YAML.
        expect(text).not.toContain('name: Optibot Review');
        expect(text).not.toContain('optibot-review:');
    });

    it('uses a provided name', async () => {
        mockReadConfig.mockResolvedValue({ apiKey: 'jwt' });
        mockCreateApiKey.mockResolvedValue({
            id: 2, name: 'production', keyPrefix: 'optk_x', key: 'optk_p', createdAt: '2026-04-30',
        });
        await handleSetupCi({ name: 'production' });
        expect(mockCreateApiKey).toHaveBeenCalledWith('production');
    });

    it('returns formatError on createApiKey failure', async () => {
        mockReadConfig.mockResolvedValue({ apiKey: 'jwt' });
        const apiErr = new Error('quota exceeded');
        mockCreateApiKey.mockRejectedValue(apiErr);
        const result = await handleSetupCi({ name: 'ci' });
        expect(result.isError).toBeTruthy();
        expect(mockFormatError).toHaveBeenCalledWith(apiErr);
    });
});
