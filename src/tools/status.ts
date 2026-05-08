import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { formatError, formatResetTime, sanitizeServerText } from '../lib/output.js';
import { getOrganizationIdFromToken } from '../lib/jwt.js';
import { ReviewStatus, OrgListResponse } from '../types.js';

export function registerStatusTool(server: McpServer): void {
    server.tool(
        'get_status',
        'Show full Optibot status: authentication method, active organization, and review quota. Mirrors `optibot status` from the CLI.',
        async () => {
            try {
                const envKey = process.env.OPTIBOT_API_KEY;
                const source = envKey ? 'OPTIBOT_API_KEY environment variable' : 'config file (~/.optibot/config.json)';

                const config = await readConfig();
                const client = new ApiClient(config.apiKey);

                // Fire both in parallel. Any individual failure is non-fatal —
                // we still show the rest of the status.
                const [orgsResult, reviewStatusResult] = await Promise.allSettled([
                    client.listOrganizations(),
                    client.getReviewStatus(),
                ]);

                const lines: string[] = ['## Authentication', ''];
                lines.push(`Method: ${source}`);
                const prefix = config.apiKey.substring(0, Math.min(8, config.apiKey.length));
                lines.push(`Key prefix: ${prefix}...`);

                if (orgsResult.status === 'fulfilled') {
                    const { organizations, currentOrganizationId } = orgsResult.value as OrgListResponse;
                    const activeId = getOrganizationIdFromToken(config.apiKey) ?? currentOrganizationId;
                    const active = organizations.find(o => o.id === activeId);

                    lines.push('', '## Organization', '');
                    if (active) {
                        const label = sanitizeServerText(active.displayName || active.name);
                        lines.push(`Active: ${label}`);
                        if (active.role) {
                            lines.push(`Role: ${sanitizeServerText(active.role)}`);
                        }
                    } else {
                        lines.push('Active: (none)');
                    }

                    if (organizations.length > 1) {
                        lines.push(`You belong to ${organizations.length} organizations. Use switch_organization to change.`);
                    }
                }

                if (reviewStatusResult.status === 'fulfilled') {
                    const rs = reviewStatusResult.value as ReviewStatus;
                    // Backend response shape can vary across deployments; only render
                    // numeric fields that are actually present so we don't surface
                    // "undefined / undefined" to the LLM.
                    const hasUsage = typeof rs?.current === 'number' && typeof rs?.limit === 'number';
                    const hasRemaining = typeof rs?.remaining === 'number';
                    if (hasUsage || hasRemaining || rs?.resetAt) {
                        lines.push('', '## Review Quota', '');
                        if (hasUsage) {
                            lines.push(`Used: ${rs.current} / ${rs.limit}`);
                        }
                        if (hasRemaining) {
                            lines.push(`Remaining: ${rs.remaining}`);
                        }
                        if (rs.resetAt) {
                            lines.push(`Resets: ${formatResetTime(rs.resetAt)}`);
                        }
                    }
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
