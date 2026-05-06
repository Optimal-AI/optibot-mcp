import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadConfig = vi.fn();
const mockWriteConfig = vi.fn();
const mockListOrganizations = vi.fn();
const mockRescopeToken = vi.fn();
const mockGetOrgIdFromToken = vi.fn();
const mockFormatError = vi.fn((err: unknown) => `formatted: ${(err as Error).message}`);
const mockSanitize = vi.fn((s: string) => s);

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: unknown[]) => mockReadConfig(...args),
    writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        listOrganizations(...args: unknown[]) { return mockListOrganizations(...args); }
        rescopeToken(...args: unknown[]) { return mockRescopeToken(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatError: (...args: unknown[]) => mockFormatError(...args),
    sanitizeServerText: (...args: unknown[]) => mockSanitize(...(args as [string])),
}));

vi.mock('../lib/jwt.js', () => ({
    getOrganizationIdFromToken: (...args: unknown[]) => mockGetOrgIdFromToken(...args),
}));

import { registerOrgTools } from './org.js';

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;

describe('org tools', () => {
    let registered: Map<string, ToolHandler>;

    beforeEach(() => {
        registered = new Map();
        mockReadConfig.mockReset();
        mockWriteConfig.mockReset();
        mockListOrganizations.mockReset();
        mockRescopeToken.mockReset();
        mockGetOrgIdFromToken.mockReset();

        const server = {
            tool: vi.fn((...args: unknown[]) => {
                const name = args[0] as string;
                const handler = args[args.length - 1] as ToolHandler;
                registered.set(name, handler);
            }),
        } as unknown as Parameters<typeof registerOrgTools>[0];

        registerOrgTools(server);
    });

    it('registers three organization tools', () => {
        expect(registered.has('list_organizations')).toBe(true);
        expect(registered.has('get_current_organization')).toBe(true);
        expect(registered.has('switch_organization')).toBe(true);
    });

    describe('list_organizations', () => {
        it('marks the current organization with *', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({
                organizations: [
                    { id: 1, name: 'Acme', role: 'owner' },
                    { id: 2, name: 'Beta', role: 'member' },
                ],
                currentOrganizationId: 2,
            });

            const result = await registered.get('list_organizations')!({});
            const text = result.content[0].text ?? '';

            expect(text).toContain('* Beta');
            expect(text).toMatch(/\s{2}Acme/);
        });

        it('handles an empty organization list', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({ organizations: [], currentOrganizationId: 0 });

            const result = await registered.get('list_organizations')!({});
            expect(result.content[0].text).toContain('do not belong to any organizations');
        });

        it('returns a formatted error when the API call fails', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockRejectedValue(new Error('API down'));

            const result = await registered.get('list_organizations')!({});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('formatted: API down');
        });
    });

    describe('get_current_organization', () => {
        it('reads the active org id from the JWT claim when available', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockGetOrgIdFromToken.mockReturnValue(7);
            mockListOrganizations.mockResolvedValue({
                organizations: [
                    { id: 1, name: 'Other' },
                    { id: 7, name: 'Seven', role: 'owner' },
                ],
                currentOrganizationId: 1, // intentionally different from the claim
            });

            const result = await registered.get('get_current_organization')!({});
            expect(result.content[0].text).toContain('Active organization: Seven');
            expect(result.content[0].text).toContain('Your role: owner');
        });

        it('falls back to currentOrganizationId when the token has no claim', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockGetOrgIdFromToken.mockReturnValue(null);
            mockListOrganizations.mockResolvedValue({
                organizations: [{ id: 1, name: 'Only' }],
                currentOrganizationId: 1,
            });

            const result = await registered.get('get_current_organization')!({});
            expect(result.content[0].text).toContain('Active organization: Only');
        });

        it('returns an error when the active org is not found in the list', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockGetOrgIdFromToken.mockReturnValue(999);
            mockListOrganizations.mockResolvedValue({
                organizations: [{ id: 1, name: 'Only' }],
                currentOrganizationId: 1,
            });

            const result = await registered.get('get_current_organization')!({});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('No active organization found');
        });
    });

    describe('switch_organization', () => {
        it('requires either organizationId or name', async () => {
            const result = await registered.get('switch_organization')!({});
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Provide either organizationId or name');
        });

        it('rescopes and overwrites the token when switching by id', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'old-token' });
            mockListOrganizations.mockResolvedValue({
                organizations: [
                    { id: 1, name: 'Acme' },
                    { id: 2, name: 'Beta' },
                ],
                currentOrganizationId: 1,
            });
            mockRescopeToken.mockResolvedValue({ token: 'new-token', expiresIn: 7_776_000, organizationId: 2 });

            const result = await registered.get('switch_organization')!({ organizationId: 2 });

            expect(mockRescopeToken).toHaveBeenCalledWith(2);
            expect(mockWriteConfig).toHaveBeenCalledWith({ apiKey: 'new-token' });
            expect(result.content[0].text).toContain('Switched to Beta');
        });

        it('rejects an unknown organizationId without rescoping', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({
                organizations: [{ id: 1, name: 'Acme' }],
                currentOrganizationId: 1,
            });

            const result = await registered.get('switch_organization')!({ organizationId: 99 });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('not in your organization list');
            expect(mockRescopeToken).not.toHaveBeenCalled();
            expect(mockWriteConfig).not.toHaveBeenCalled();
        });

        it('resolves by name when exactly one match exists', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({
                organizations: [
                    { id: 1, name: 'Acme' },
                    { id: 2, name: 'Beta' },
                ],
                currentOrganizationId: 1,
            });
            mockRescopeToken.mockResolvedValue({ token: 'new', expiresIn: 100, organizationId: 2 });

            const result = await registered.get('switch_organization')!({ name: 'Beta' });

            expect(mockRescopeToken).toHaveBeenCalledWith(2);
            expect(result.content[0].text).toContain('Switched to Beta');
        });

        it('rejects ambiguous name matches and recommends organizationId', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({
                organizations: [
                    { id: 1, name: 'Acme' },
                    { id: 2, name: 'Acme' },
                ],
                currentOrganizationId: 1,
            });

            const result = await registered.get('switch_organization')!({ name: 'Acme' });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Multiple organizations match');
            expect(mockRescopeToken).not.toHaveBeenCalled();
        });

        it('no-ops when already on the target organization', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'k' });
            mockListOrganizations.mockResolvedValue({
                organizations: [{ id: 1, name: 'Acme' }],
                currentOrganizationId: 1,
            });

            const result = await registered.get('switch_organization')!({ organizationId: 1 });

            expect(result.content[0].text).toContain('Already active');
            expect(mockRescopeToken).not.toHaveBeenCalled();
            expect(mockWriteConfig).not.toHaveBeenCalled();
        });
    });
});
