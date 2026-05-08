import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { sanitizeServerText } from '../lib/output.js';
import { getOrganizationIdFromToken } from '../lib/jwt.js';
import { mapScanError, formatScanErrorForTool, ScanErrorInfo } from '../lib/scanErrors.js';
import { waitForScanCompletion } from '../lib/scanPoller.js';
import { SecurityScanProgressService } from '../lib/scanProgress.js';
import { safeSendLog } from '../lib/notify.js';
import {
    RepositoryStats,
    ScanTriggerRequest,
    SecurityScanResult,
    SecurityConfigSaveRequest,
    SecurityScanProgressEvent,
    SecurityModelTier,
    SecuritySchedule,
} from '../types.js';

// ------ shared helpers ------

interface AuthedContext {
    client: ApiClient;
    organizationId: number;
}

interface ErrorToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError: true;
    [key: string]: unknown;
}

type ToolExtra = {
    sendNotification?: (notification: {
        method: 'notifications/message';
        params: { level: 'info'; logger: string; data: string };
    }) => void;
};

function errorResult(info: ScanErrorInfo): ErrorToolResult {
    return {
        isError: true,
        content: [
            {
                type: 'text' as const,
                text: [
                    formatScanErrorForTool(info),
                    '',
                    '```json',
                    JSON.stringify(info.data, null, 2),
                    '```',
                ].join('\n'),
            },
        ],
    };
}

function fromErr(err: unknown): ErrorToolResult {
    return errorResult(mapScanError(err));
}

async function getAuthedContext(): Promise<AuthedContext | ErrorToolResult> {
    let config;
    try {
        config = await readConfig();
    } catch (err) {
        return fromErr(err);
    }

    const client = new ApiClient(config.apiKey);

    // Prefer the JWT claim (authoritative) over the server's
    // currentOrganizationId — they should match, but the claim is what the
    // backend will use to authorize the request.
    const claim = getOrganizationIdFromToken(config.apiKey);
    if (claim !== null) {
        return { client, organizationId: claim };
    }

    try {
        const { currentOrganizationId } = await client.listOrganizations();
        return { client, organizationId: currentOrganizationId };
    } catch (err) {
        return fromErr(err);
    }
}

async function resolveRepo(
    ctx: AuthedContext,
    input: string | number,
): Promise<{ repo: RepositoryStats; repos: RepositoryStats[] } | ErrorToolResult> {
    let repos: RepositoryStats[];
    try {
        repos = await ctx.client.listRepositoryStats(ctx.organizationId);
    } catch (err) {
        return fromErr(err);
    }

    if (typeof input === 'number') {
        const byId = repos.find(r => r.id === input);
        if (byId) return { repo: byId, repos };
        return errorResult(mapScanError(Object.assign(new Error('Not found'), {
            status: 404,
            data: { error: `Repository id ${input} not found in the active organization` },
        })));
    }

    const matches = repos.filter(r => r.name === input || r.fullName === input);
    if (matches.length === 1) return { repo: matches[0], repos };
    if (matches.length > 1) {
        return errorResult(mapScanError(Object.assign(new Error('Ambiguous'), {
            status: 400,
            data: { error: `Ambiguous repository name "${input}" — provide the id instead. Matching ids: ${matches.map(m => m.id).join(', ')}` },
        })));
    }
    return errorResult(mapScanError(Object.assign(new Error('Not found'), {
        status: 404,
        data: { error: `Repository "${input}" not found` },
    })));
}

function isErrorResult(x: unknown): x is ErrorToolResult {
    return typeof x === 'object' && x !== null && (x as { isError?: unknown }).isError === true;
}

function formatProgressStep(event: SecurityScanProgressEvent): string {
    const prefix = '[scan]';
    const d = event.details;
    switch (event.step) {
        case 'started':
            return `${prefix} ${d?.repoName ? `Scanning ${sanitizeServerText(d.repoName)}` : 'Scan started'}`;
        case 'cloning_repository':
            return `${prefix} Cloning repository${d?.repoName ? ` ${sanitizeServerText(d.repoName)}` : ''}`;
        case 'scanning_code':
            return `${prefix} Scanning code`;
        case 'tool_call':
            return `${prefix} Tool: ${sanitizeServerText(d?.tool || 'unknown')}${d?.query ? ` — ${sanitizeServerText(d.query)}` : ''}`;
        case 'budget_update': {
            const tokens = typeof d?.tokensUsed === 'number' ? d.tokensUsed.toLocaleString() : '?';
            const cost = typeof d?.costUSD === 'number' ? `$${d.costUSD.toFixed(4)}` : '?';
            return `${prefix} Usage: ${tokens} tokens · ${cost}`;
        }
        case 'generating_report':
            return `${prefix} Generating report`;
        case 'completed':
            return `${prefix} Scan completed`;
        case 'failed':
            return `${prefix} Scan failed${d?.reason ? `: ${sanitizeServerText(d.reason)}` : ''}`;
        default:
            return `${prefix} ${sanitizeServerText(event.message)}`;
    }
}

function summarizeScanResult(result: SecurityScanResult, repoLabel?: string): string {
    const lines: string[] = [];
    lines.push(`Scan #${result.id} — ${result.status}`);
    if (repoLabel) lines.push(`Repository: ${sanitizeServerText(repoLabel)}`);
    lines.push(`Issues found: ${result.issueCount}`);
    if (result.severity) {
        const sev = result.severity;
        const parts = [
            sev.critical ? `critical: ${sev.critical}` : null,
            sev.high ? `high: ${sev.high}` : null,
            sev.medium ? `medium: ${sev.medium}` : null,
            sev.low ? `low: ${sev.low}` : null,
        ].filter((x): x is string => Boolean(x));
        if (parts.length) lines.push(`Severity: ${parts.join(', ')}`);
    }
    lines.push(`Tokens used: ${result.tokensUsed.toLocaleString()}`);
    lines.push(`Cost: $${result.costUSD.toFixed(4)}`);
    if (result.modelTier) lines.push(`Model tier: ${result.modelTier}`);
    if (result.externalIssueUrl) lines.push(`Issue URL: ${sanitizeServerText(result.externalIssueUrl)}`);
    return lines.join('\n');
}

// ------ tools ------

const TriggerScanSchema = {
    repositoryId: z.number().int().positive().optional()
        .describe('Repository id to scan. Provide either repositoryId or name.'),
    name: z.string().optional()
        .describe('Repository name or fullName to scan. Used only when repositoryId is not provided.'),
    modelTier: z.enum(['low', 'medium', 'high']).optional()
        .describe('Model tier: low (cheapest), medium, high (most thorough). Server default if omitted.'),
    maxBudgetUSD: z.number().min(0.5).max(500).optional()
        .describe('Max budget per scan in USD (0.50–500).'),
    postAsIssue: z.boolean().optional()
        .describe('If true, open the scan report as a GitHub/GitLab issue on completion.'),
    timeoutSeconds: z.number().int().min(30).max(1800).optional()
        .describe('How long to wait for completion before returning a still_running handoff. Default 300.'),
};

const ListScansSchema = {
    repositoryId: z.number().int().positive().optional().describe('Filter by repository id.'),
    name: z.string().optional().describe('Filter by repository name or fullName.'),
    page: z.number().int().positive().optional().describe('Page number (default 1).'),
    pageSize: z.number().int().min(1).max(50).optional().describe('Results per page (default 5, max 50).'),
};

const GetScanSchema = {
    scanId: z.number().int().positive().describe('Scan id (from list_security_scans).'),
};

const UpdateConfigSchema = {
    enabled: z.boolean().optional().describe('Enable or disable scheduled scans.'),
    schedule: z.enum(['weekly', 'monthly', 'quarterly', 'custom']).optional()
        .describe('Scan frequency. If "custom", provide customCron.'),
    customCron: z.string().optional().describe('Cron expression (required when schedule=custom).'),
    modelTier: z.enum(['low', 'medium', 'high']).optional().describe('Model tier for scheduled scans.'),
    maxBudgetUSD: z.number().min(0.5).max(500).optional().describe('Max budget per scheduled scan.'),
    repositoryIds: z.array(z.number().int().positive()).optional()
        .describe('List of repository ids to include in scheduled scans. Replaces the existing list.'),
    postAsIssue: z.boolean().optional().describe('Whether to open scan reports as repository issues.'),
};

type ToolDef<S extends z.ZodRawShape> = (
    name: string,
    description: string,
    schema: S,
    handler: (input: z.infer<z.ZodObject<S>>, extra: ToolExtra) => Promise<unknown>,
) => void;

function tool<S extends z.ZodRawShape>(
    server: McpServer,
    name: string,
    description: string,
    schema: S,
    handler: (input: z.infer<z.ZodObject<S>>, extra: ToolExtra) => Promise<unknown>,
): void {
    (server.tool as unknown as ToolDef<S>)(name, description, schema, handler);
}

export function registerScanTools(server: McpServer): void {

    // Tool: trigger_security_scan
    tool(server, 'trigger_security_scan',
        'Trigger an AI security scan on a repository in the active organization. Blocks until the scan completes (or the timeout is reached, in which case it returns a "still_running" handoff). Streams live progress events. Accepts either repositoryId or name.',
        TriggerScanSchema,
        async (input, extra) => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            if (input.repositoryId === undefined && !input.name) {
                return errorResult(mapScanError(Object.assign(new Error('Missing repo'), {
                    status: 400,
                    data: { error: 'Provide either repositoryId or name.' },
                })));
            }

            const resolved = await resolveRepo(ctx, input.repositoryId ?? input.name!);
            if (isErrorResult(resolved)) return resolved;

            const repoLabel = resolved.repo.fullName || resolved.repo.name;

            const body: ScanTriggerRequest = { repositoryId: resolved.repo.id };
            if (input.maxBudgetUSD !== undefined) body.maxBudgetUSD = input.maxBudgetUSD;
            if (input.modelTier) body.modelTier = input.modelTier;
            if (input.postAsIssue) body.postAsIssue = input.postAsIssue;

            const progressService = new SecurityScanProgressService();
            const sessionId = await progressService.startSession((event) => {
                safeSendLog(extra, 'optibot', formatProgressStep(event));
            });

            try {
                const startIso = new Date().toISOString();

                let triggerResponse;
                try {
                    triggerResponse = await ctx.client.triggerSecurityScan(body, sessionId);
                } catch (err) {
                    return fromErr(err);
                }

                const timeoutSeconds = input.timeoutSeconds ?? 300;
                let waitResult;
                try {
                    waitResult = await waitForScanCompletion(ctx.client, {
                        repositoryId: resolved.repo.id,
                        sinceIso: startIso,
                        timeoutMs: timeoutSeconds * 1000,
                    });
                } catch (err) {
                    return fromErr(err);
                }

                if (waitResult.status === 'timeout') {
                    const handoff = {
                        status: 'still_running' as const,
                        message: `Scan started on ${repoLabel} but did not finish within ${timeoutSeconds}s. Call list_security_scans or get_security_scan later to retrieve the result.`,
                        sessionId: triggerResponse.sessionId ?? sessionId,
                        repositoryId: resolved.repo.id,
                    };
                    return {
                        content: [{
                            type: 'text' as const,
                            text: [
                                handoff.message,
                                '',
                                '```json',
                                JSON.stringify(handoff, null, 2),
                                '```',
                            ].join('\n'),
                        }],
                    };
                }

                const result = waitResult.result;
                const summary = summarizeScanResult(result, repoLabel);
                const report = result.content ? sanitizeServerText(result.content) : '(no report body)';
                return {
                    content: [{
                        type: 'text' as const,
                        text: [summary, '', '---', '', report].join('\n'),
                    }],
                    isError: result.status !== 'completed',
                };
            } finally {
                progressService.endSession();
            }
        },
    );

    // Tool: list_security_scans
    tool(server, 'list_security_scans',
        'List recent security scans for the active organization. Optionally filter by repository. Paginated.',
        ListScansSchema,
        async (input) => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                let repositoryIds: number[] | undefined;
                let repoMap: Map<number, string> = new Map();

                if (input.repositoryId !== undefined || input.name) {
                    const resolved = await resolveRepo(ctx, input.repositoryId ?? input.name!);
                    if (isErrorResult(resolved)) return resolved;
                    repositoryIds = [resolved.repo.id];
                    for (const r of resolved.repos) {
                        repoMap.set(r.id, r.fullName || r.name);
                    }
                } else {
                    // For labels in the output — best-effort; don't fail the list
                    // if stats can't be fetched.
                    try {
                        const repos = await ctx.client.listRepositoryStats(ctx.organizationId);
                        for (const r of repos) {
                            repoMap.set(r.id, r.fullName || r.name);
                        }
                    } catch {
                        // swallow — labels are optional
                    }
                }

                const page = await ctx.client.listSecurityIssues({
                    page: input.page,
                    pageSize: input.pageSize,
                    repositoryIds,
                });

                if (page.items.length === 0) {
                    return { content: [{ type: 'text' as const, text: 'No security scans found.' }] };
                }

                const lines: string[] = [
                    `Security scans (page ${page.page} of ${page.totalPages}, ${page.totalItems} total):`,
                    '',
                ];
                for (const item of page.items) {
                    const label = repoMap.get(item.repositoryId) ?? `repo ${item.repositoryId}`;
                    lines.push(`- #${item.id} [${item.status}] ${sanitizeServerText(label)} — ${item.issueCount} issues · $${item.costUSD.toFixed(4)} · ${item.scanDate}`);
                }
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: get_security_scan
    tool(server, 'get_security_scan',
        'Fetch the full markdown report and metadata for a specific security scan by id. The backend has no by-id endpoint, so this pages through recent scans up to a reasonable cap.',
        GetScanSchema,
        async (input) => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const maxPages = 50;
                const pageSize = 50;
                let match: SecurityScanResult | undefined;
                for (let page = 1; page <= maxPages; page++) {
                    const resp = await ctx.client.listSecurityIssues({ page, pageSize });
                    match = resp.items.find(it => it.id === input.scanId);
                    if (match) break;
                    if (page >= resp.totalPages) break;
                }
                if (!match) {
                    return errorResult(mapScanError(Object.assign(new Error('Not found'), {
                        status: 404,
                        data: { error: `Scan ${input.scanId} not found in the ${maxPages * pageSize} most recent scans.` },
                    })));
                }

                const summary = summarizeScanResult(match);
                const report = match.content ? sanitizeServerText(match.content) : '(no report body)';
                return {
                    content: [{
                        type: 'text' as const,
                        text: [summary, '', '---', '', report].join('\n'),
                    }],
                };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: get_security_usage
    server.tool(
        'get_security_usage',
        'Show current-month token usage and cost for security scans on the active organization.',
        async () => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const usage = await ctx.client.getSecurityUsage();
                const lines = [
                    `Security scan usage for ${usage.month}/${usage.year}:`,
                    '',
                    `Tokens used: ${usage.tokensUsed.toLocaleString()}`,
                    `Cost:        $${usage.costUSD.toFixed(4)}`,
                ];
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: get_security_pricing
    server.tool(
        'get_security_pricing',
        'Show per-tier pricing and markup multiplier for security scans.',
        async () => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const pricing = await ctx.client.getSecurityPricing();
                const lines: string[] = [
                    'Security scan pricing:',
                    '',
                    `Markup multiplier: ${pricing.markupMultiplier}x (applied on top of raw model cost)`,
                    '',
                ];
                for (const tier of ['low', 'medium', 'high'] as const) {
                    const t = pricing.tiers[tier];
                    lines.push(`## ${tier} tier`);
                    lines.push(`- Input:       $${t.inputCostPer1M.toFixed(4)} per 1M tokens`);
                    lines.push(`- Output:      $${t.outputCostPer1M.toFixed(4)} per 1M tokens`);
                    lines.push(`- Cache read:  $${t.cacheReadCostPer1M.toFixed(4)} per 1M tokens`);
                    lines.push(`- Cache write: $${t.cacheWriteCostPer1M.toFixed(4)} per 1M tokens`);
                    lines.push('');
                }
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: list_scannable_repos
    server.tool(
        'list_scannable_repos',
        'List repositories available to scan in the active organization. Use these ids/names when calling trigger_security_scan.',
        async () => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const repos = await ctx.client.listRepositoryStats(ctx.organizationId);
                if (repos.length === 0) {
                    return { content: [{ type: 'text' as const, text: 'No repositories available in the active organization.' }] };
                }
                const lines: string[] = [`Scannable repositories (${repos.length}):`, ''];
                for (const r of repos) {
                    const label = r.fullName || r.name;
                    lines.push(`- ${sanitizeServerText(label)} (id: ${r.id})`);
                }
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: get_security_config
    server.tool(
        'get_security_config',
        'Show the scheduled-scan configuration (schedule, enabled repos, budget, tier) for the active organization.',
        async () => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const [cfgResp, repos] = await Promise.all([
                    ctx.client.getSecurityConfig(ctx.organizationId),
                    ctx.client.listRepositoryStats(ctx.organizationId).catch(() => [] as RepositoryStats[]),
                ]);

                const cfg = cfgResp.config;
                const repoMap = new Map<number, string>();
                for (const r of repos) repoMap.set(r.id, r.fullName || r.name);

                const lines: string[] = ['## Scheduled Security Scan Config', ''];
                lines.push(`Enabled: ${cfg.enabled ? 'yes' : 'no'}`);
                lines.push(`Schedule: ${cfg.schedule}${cfg.customCron ? ` (${cfg.customCron})` : ''}`);
                lines.push(`Model tier: ${cfg.modelTier}`);
                lines.push(`Max budget: $${cfg.maxBudgetUSD.toFixed(2)}`);
                lines.push(`Post as issue: ${cfg.postAsIssue ? 'yes' : 'no'}`);
                lines.push('');
                lines.push('Selected repositories:');
                if (cfg.selectedRepositoryIds.length === 0) {
                    lines.push('  (none)');
                } else {
                    for (const id of cfg.selectedRepositoryIds) {
                        const label = repoMap.get(id) ?? `repo ${id}`;
                        lines.push(`  - ${sanitizeServerText(label)} (id: ${id})`);
                    }
                }
                if (cfg.lastScanDate) {
                    lines.push('');
                    lines.push(`Last scheduled scan: ${cfg.lastScanDate}`);
                }
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return fromErr(err);
            }
        },
    );

    // Tool: update_security_config
    tool(server, 'update_security_config',
        'Update the scheduled-scan configuration for the active organization. Only specified fields are changed; unspecified fields keep their current value. When schedule is "custom", customCron is required.',
        UpdateConfigSchema,
        async (input) => {
            const ctx = await getAuthedContext();
            if (isErrorResult(ctx)) return ctx;

            try {
                const current = await ctx.client.getSecurityConfig(ctx.organizationId);

                const schedule: SecuritySchedule = input.schedule ?? current.config.schedule;
                const next: SecurityConfigSaveRequest = {
                    enabled: input.enabled ?? current.config.enabled,
                    schedule,
                    postAsIssue: input.postAsIssue ?? current.config.postAsIssue,
                    modelTier: (input.modelTier as SecurityModelTier | undefined) ?? current.config.modelTier,
                    maxBudgetUSD: input.maxBudgetUSD ?? current.config.maxBudgetUSD,
                    repositoryIds: input.repositoryIds ?? current.config.selectedRepositoryIds,
                };

                if (schedule === 'custom') {
                    const cron = input.customCron ?? current.config.customCron ?? undefined;
                    if (!cron) {
                        return errorResult(mapScanError(Object.assign(new Error('Missing cron'), {
                            status: 400,
                            data: { error: 'schedule=custom requires customCron.' },
                        })));
                    }
                    next.customCron = cron;
                }

                const saved = await ctx.client.saveSecurityConfig(ctx.organizationId, next);
                return {
                    content: [{
                        type: 'text' as const,
                        text: [
                            sanitizeServerText(saved.message || 'Configuration updated.'),
                            '',
                            '```json',
                            JSON.stringify(saved.config, null, 2),
                            '```',
                        ].join('\n'),
                    }],
                };
            } catch (err) {
                return fromErr(err);
            }
        },
    );
}
