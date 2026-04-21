import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig, writeConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { formatError, sanitizeServerText } from '../lib/output.js';
import { getOrganizationIdFromToken } from '../lib/jwt.js';
import { Organization } from '../types.js';

const SwitchOrgSchema = {
    organizationId: z.number().int().positive().optional()
        .describe('Organization id to switch to. Provide either organizationId or name.'),
    name: z.string().optional()
        .describe('Organization name (or displayName) to switch to. Used only when organizationId is not provided. Must match exactly one organization.'),
};

function labelFor(org: Organization): string {
    return sanitizeServerText(org.displayName || org.name);
}

function formatOrganizationLine(org: Organization, isActive: boolean): string {
    const marker = isActive ? '*' : ' ';
    const role = org.role ? ` (${sanitizeServerText(org.role)})` : '';
    return `${marker} ${labelFor(org)}${role}`;
}

export function registerOrgTools(server: McpServer): void {
    // Tool: list_organizations
    server.tool(
        'list_organizations',
        'List all Optibot organizations you belong to. The currently active organization is marked with "*". Use switch_organization to change it.',
        async () => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const { organizations, currentOrganizationId } = await client.listOrganizations();

                if (organizations.length === 0) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: 'You do not belong to any organizations yet. Complete onboarding at https://agents.getoptimal.ai',
                        }],
                    };
                }

                const sorted = [...organizations].sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
                const lines: string[] = [`Organizations (${sorted.length}):`, ''];
                for (const org of sorted) {
                    lines.push(formatOrganizationLine(org, org.id === currentOrganizationId));
                }

                if (organizations.length > 1) {
                    lines.push('');
                    lines.push('Use `switch_organization` with either organizationId or name to change the active one.');
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: get_current_organization
    server.tool(
        'get_current_organization',
        'Show the currently active Optibot organization and your role in it. Read from the JWT organizationId claim (the authoritative source).',
        async () => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const { organizations, currentOrganizationId } = await client.listOrganizations();

                const claimId = getOrganizationIdFromToken(config.apiKey);
                const activeId = claimId ?? currentOrganizationId;

                const active = organizations.find(o => o.id === activeId);
                if (!active) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: 'No active organization found for this token. Try logging in again or complete onboarding.',
                        }],
                        isError: true,
                    };
                }

                const lines = [
                    `Active organization: ${labelFor(active)}`,
                ];
                if (active.role) {
                    lines.push(`Your role: ${sanitizeServerText(active.role)}`);
                }
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: switch_organization
    (server.tool as unknown as (
        name: string,
        description: string,
        schema: typeof SwitchOrgSchema,
        handler: (input: { organizationId?: number; name?: string }) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
    ) => void)(
        'switch_organization',
        'Switch the active Optibot organization. Rescopes your token so subsequent tool calls act as that organization. Accept either organizationId or name — if multiple orgs share a name, provide organizationId instead. Token is replaced in ~/.optibot/config.json.',
        SwitchOrgSchema,
        async ({ organizationId, name }) => {
            try {
                if (organizationId === undefined && !name) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: 'Provide either organizationId or name. Call list_organizations to see available choices.',
                        }],
                        isError: true,
                    };
                }

                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const { organizations, currentOrganizationId } = await client.listOrganizations();

                let targetId: number;
                let target: Organization | undefined;

                if (organizationId !== undefined) {
                    target = organizations.find(o => o.id === organizationId);
                    if (!target) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `Organization id ${organizationId} is not in your organization list.`,
                            }],
                            isError: true,
                        };
                    }
                    targetId = organizationId;
                } else {
                    const needle = name!;
                    const matches = organizations.filter(o => o.name === needle || o.displayName === needle);
                    if (matches.length === 0) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `No organization named "${sanitizeServerText(needle)}". Call list_organizations to see available choices.`,
                            }],
                            isError: true,
                        };
                    }
                    if (matches.length > 1) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `Multiple organizations match "${sanitizeServerText(needle)}". Use organizationId instead — ids: ${matches.map(m => m.id).join(', ')}.`,
                            }],
                            isError: true,
                        };
                    }
                    target = matches[0];
                    targetId = target.id;
                }

                if (targetId === currentOrganizationId) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Already active on ${labelFor(target)}.`,
                        }],
                    };
                }

                const rescoped = await client.rescopeToken(targetId);
                // Replace the stored token — the new one embeds the new org in
                // its organizationId claim. We do not persist the id separately.
                await writeConfig({ apiKey: rescoped.token });

                return {
                    content: [{
                        type: 'text' as const,
                        text: `Switched to ${labelFor(target)}. Token updated in ~/.optibot/config.json.`,
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
