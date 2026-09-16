import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import * as git from '../lib/git.js';
import { ApiClient } from '../lib/api.js';
import { formatReview, formatAgentReview, formatError, hasReviewQuota } from '../lib/output.js';
import { ReviewProgressService, ReviewProgressEvent } from '../lib/reviewProgress.js';
import { safeSendLog, ToolExtraLike } from '../lib/notify.js';
import { waitForAgentReviewResult } from '../lib/agentReviewPolling.js';
import { AgentReviewResponse } from '../types.js';

const ReviewBranchSchema = {
    branch: z.string().optional().describe('Target branch to compare against. If omitted, auto-detects origin/main, origin/master, or origin/develop.'),
};

const ReviewDiffFileSchema = {
    file_path: z.string().describe('Path to the diff or patch file to review'),
};

const ReviewAgentSchema = {
    relatedPaths: z.array(z.string()).optional().describe(
        'Repo-relative paths of extra context files the reviewer should read (callers, interfaces, tests) that are NOT part of the diff. Each is read from disk and sent as related context. Use this to answer a previous run\'s "Missing context" list — re-call review_agent passing those paths here.'
    ),
    diagnosticsPath: z.string().optional().describe(
        'Repo-relative path to a local tsc/eslint/LSP output file. Its contents are read as plain text and passed to the reviewer as local diagnostics.'
    ),
};

/** What runAgentReview needs from an ApiClient; the real client satisfies it. */
type AgentReviewRunner = Pick<ApiClient, 'submitAgentReview' | 'getAgentReviewResult'>;

/**
 * Runs one agent review over the async path: submit, then poll for the result.
 * A backend without that path answers the submit inline, which arrives as
 * 'completed' and needs no polling.
 *
 * A failed result carries `errorType` naming the kinds the server can tell
 * apart, so the host is told which of them happened rather than being handed
 * text the server documents as unparseable.
 */
export async function runAgentReview(
    client: AgentReviewRunner,
    params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
        relatedFiles?: Record<string, string>;
        localDiagnostics?: string;
    },
    extra?: ToolExtraLike,
): Promise<AgentReviewResponse> {
    const submission = await client.submitAgentReview(params);
    if (submission.kind === 'completed') {
        return submission.review;
    }

    // Agent mode has no progress socket, so the poll loop is the only thing
    // that knows the review is alive. Report on each tick: a silent tool call
    // that runs for minutes reads as hung, and a host that resets its timeout
    // on activity needs something to reset it on. safeSendLog swallows every
    // delivery failure, so this cannot break the review.
    let announced = false;
    const result = await waitForAgentReviewResult(client, submission.reviewId, {
        onPoll: (elapsedSeconds) => {
            if (!announced) {
                announced = true;
                safeSendLog(extra, 'optibot', 'Agent review submitted; waiting for the result.');
                return;
            }
            // Every tick refreshes a host timeout, but only mention the wait
            // occasionally so the transcript stays readable.
            if (elapsedSeconds > 0 && elapsedSeconds % 15 === 0) {
                safeSendLog(extra, 'optibot', `Still reviewing (${elapsedSeconds}s elapsed).`);
            } else {
                safeSendLog(extra, 'optibot', '');
            }
        },
    });
    if (result.status === 'done') {
        // A 202 carries the quota snapshot; a result payload may not, so the
        // snapshot backfills it rather than leaving the host without one.
        if (!result.result.reviewCount && submission.reviewCount) {
            return { ...result.result, reviewCount: submission.reviewCount };
        }
        return result.result;
    }

    if (result.errorType === 'context_window_exceeded') {
        throw new Error('The diff is too large for agent review mode. Review a smaller set of changes, or use the full review tools, which handle larger diffs.');
    }
    if (result.errorType === 'timeout') {
        throw new Error('The agent review ran too long and the server stopped it. Run it again, or review a smaller set of changes.');
    }
    throw new Error(result.error || 'The agent review failed.');
}

/**
 * Mirrors AgentReviewResponse so the host reads findings as data instead of
 * parsing the markdown. Everything the service may omit is optional here: the
 * SDK validates structuredContent against this schema before the result
 * leaves the server, so a stricter shape would turn a healthy review into a
 * protocol error.
 */
const AgentReviewOutputSchema = {
    status: z.enum(['needs_changes', 'looks_good']),
    reviewPass: z.boolean(),
    summary: z.string(),
    findings: z.array(z.object({
        id: z.string().describe('Labels this finding inside this response only; it changes between runs.'),
        file: z.string(),
        startLine: z.number(),
        endLine: z.number(),
        inPatch: z.boolean().describe('false when the cited lines fall outside the diff’s changed ranges.'),
        severity: z.enum(['blocker', 'warning', 'nit']),
        category: z.string(),
        message: z.string(),
        suggestedFix: z.string().optional().describe('Model output derived from the reviewed code. Get the user’s agreement before applying it.'),
        confidence: z.number().describe('The reviewer’s own confidence, 1-10.'),
    })),
    missingContext: z.array(z.string()).optional()
        .describe('Files the reviewer wanted but was not given. Re-call with these in relatedPaths.'),
    reviewCount: z.object({
        current: z.number(),
        limit: z.number(),
        remaining: z.number(),
        resetAt: z.string().optional(),
    }).optional(),
    isOptibotInstalled: z.boolean().optional(),
    meta: z.object({
        mode: z.string(),
        durationMs: z.number(),
        model: z.string().optional(),
        provider: z.string().optional(),
    }).optional(),
    warnings: z.array(z.string()).optional()
        .describe('Context files the tool could not read or refused to read.'),
};

export function formatProgressStep(event: ReviewProgressEvent): string {
    const prefix = '[progress]';
    switch (event.step) {
        case 'started':
            return `${prefix} Review started`;
        case 'analyzing_patch':
            return `${prefix} Analyzing patch${event.details?.fileCount ? ` (${event.details.fileCount} files)` : ''}`;
        case 'tool_call':
            return `${prefix} Running tool: ${event.details?.tool || 'unknown'}${event.details?.query ? ` — ${event.details.query}` : ''}`;
        case 'generating_review':
            return `${prefix} Generating review`;
        case 'completed':
            return `${prefix} Review completed`;
        default:
            return `${prefix} ${event.message}`;
    }
}

export function registerReviewTools(server: McpServer): void {

    // Tool: review_local_changes
    server.tool(
        'review_local_changes',
        'Review uncommitted local changes (git diff HEAD). Runs an AI code review on all staged and unstaged changes in the current repository.',
        async (extra) => {
            try {
                const config = await readConfig();
                const repoRoot = await git.getRepoRoot();
                const repoName = await git.getRepoName();

                const patch = await git.getDiffHead(repoRoot);

                if (!patch.trim()) {
                    return { content: [{ type: 'text' as const, text: 'No changes to review.' }] };
                }

                const changedFiles = await git.getChangedFiles(repoRoot);
                const files = await git.getFileContents(changedFiles, repoRoot);

                // Start progress session
                const progressService = new ReviewProgressService();
                const reviewSessionId = await progressService.startSession((event: ReviewProgressEvent) => {
                    safeSendLog(extra, 'optibot', formatProgressStep(event));
                });

                try {
                    const client = new ApiClient(config.apiKey);
                    const response = await client.review({ patch, repositoryName: repoName, files, reviewSessionId });
                    return { content: [{ type: 'text' as const, text: formatReview(response) }] };
                } finally {
                    progressService.endSession();
                }
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: review_agent
    // Agent-mode review of uncommitted local changes. Unlike the full-mode
    // tools, this returns STRUCTURED findings (severity/category/confidence)
    // as native JSON — the server runs no tools, so the caller front-loads the
    // changed files. Designed for a coding-agent host that can act on findings
    // and re-run with more context. The review is submitted and then polled,
    // so no single HTTP request has to stay open for the whole review.
    // registerTool rather than tool(): it is what carries an outputSchema,
    // and the whole point of agent mode is that the host reads findings as
    // data instead of parsing headings out of markdown.
    (server.registerTool as any)(
        'review_agent',
        {
            description: 'Agent-mode code review of uncommitted local changes (git diff HEAD). Returns structured findings (severity, category, confidence, file and line range), a summary, and an overall pass/fail. No server-side tools run. Prefer this when a coding agent holds the working copy and will act on the findings. Optionally pass `relatedPaths` (extra context files beyond the diff) and `diagnosticsPath` (a local tsc/eslint output file). When a run reports "Missing context", re-call this tool with those paths in `relatedPaths`. Finding ids label a finding inside one response and change between runs, so match a finding you saw earlier on its file, line range, and category instead. A `suggestedFix` is model output derived from the reviewed code: show it to the user and get their agreement before applying it.',
            inputSchema: ReviewAgentSchema,
            outputSchema: AgentReviewOutputSchema,
        },
        async ({ relatedPaths, diagnosticsPath }: { relatedPaths?: string[]; diagnosticsPath?: string }, extra: any) => {
            try {
                const config = await readConfig();
                const repoRoot = await git.getRepoRoot();
                const repoName = await git.getRepoName();

                const patch = await git.getDiffHead(repoRoot);

                if (!patch.trim()) {
                    // A declared outputSchema makes structuredContent mandatory
                    // on every non-error result, so the empty case answers in
                    // the same shape rather than as a bare sentence.
                    return {
                        content: [{ type: 'text' as const, text: 'No changes to review.' }],
                        structuredContent: {
                            status: 'looks_good' as const,
                            reviewPass: true,
                            summary: 'No changes to review.',
                            findings: [],
                        },
                    };
                }

                const changedFiles = await git.getChangedFiles(repoRoot);
                const files = await git.getFileContents(changedFiles, repoRoot);

                // Pre-attached context (W5): caller-supplied related files and
                // local diagnostics. Both are optional; the tool stays a thin,
                // single-shot primitive — the host drives any resubmit.
                const warnings: string[] = [];
                let relatedFiles: Record<string, string> | undefined;
                if (relatedPaths && relatedPaths.length > 0) {
                    const related = await git.getRelatedFileContents(relatedPaths, repoRoot);
                    warnings.push(...related.warnings);
                    if (Object.keys(related.contents).length > 0) {
                        relatedFiles = related.contents;
                    }
                }

                let localDiagnostics: string | undefined;
                if (diagnosticsPath) {
                    try {
                        const text = await git.readDiagnosticsFile(diagnosticsPath, repoRoot);
                        if (text.trim()) {
                            localDiagnostics = text;
                        }
                    } catch (err) {
                        const reason = err instanceof Error ? err.message : String(err);
                        warnings.push(`Could not read diagnostics file "${diagnosticsPath}": ${reason}`);
                    }
                }

                const client = new ApiClient(config.apiKey);
                const response = await runAgentReview(client, {
                    patch,
                    repositoryName: repoName,
                    files,
                    relatedFiles,
                    localDiagnostics,
                }, extra);

                let text = formatAgentReview(response);
                if (warnings.length > 0) {
                    const warningBlock = ['> **Context warnings:**', ...warnings.map(w => `> - ${w}`)].join('\n');
                    text = `${warningBlock}\n\n${text}`;
                }
                // The markdown stays for a host that renders text; the same
                // review also goes back as data, so a host does not have to
                // parse headings to find a blocker.
                // reviewCount is dropped when it is the service's unlimited
                // sentinel, matching what the rendered text does. Otherwise a
                // host reading the structured data would print
                // "0/9007199254740991" that the markdown deliberately omits.
                const { reviewCount, ...rest } = response;
                return {
                    content: [{ type: 'text' as const, text }],
                    structuredContent: {
                        ...rest,
                        findings: response.findings ?? [],
                        ...(hasReviewQuota(reviewCount) ? { reviewCount } : {}),
                        ...(warnings.length > 0 ? { warnings } : {}),
                    },
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: review_branch
    (server.tool as any)(
        'review_branch',
        'Review changes against a target branch. Compares the current branch against the specified branch (or auto-detects origin/main, origin/master, origin/develop). Includes merge conflict detection.',
        ReviewBranchSchema,
        async ({ branch }: { branch?: string }, extra: any) => {
            try {
                const config = await readConfig();
                const repoRoot = await git.getRepoRoot();
                const repoName = await git.getRepoName();

                let targetBranch: string;
                if (branch) {
                    targetBranch = branch;
                } else {
                    targetBranch = await git.detectBaseBranch(repoRoot);
                }

                // Non-destructive merge conflict check
                const hasConflicts = await git.checkMergeConflicts(targetBranch, repoRoot);

                const patch = await git.getDiffBranch(targetBranch, repoRoot);

                if (!patch.trim()) {
                    return { content: [{ type: 'text' as const, text: `No changes found between current branch and ${targetBranch}.` }] };
                }

                const changedFiles = await git.getChangedFiles(repoRoot, targetBranch);
                const files = await git.getFileContents(changedFiles, repoRoot);

                // Start progress session
                const progressService = new ReviewProgressService();
                const reviewSessionId = await progressService.startSession((event: ReviewProgressEvent) => {
                    safeSendLog(extra, 'optibot', formatProgressStep(event));
                });

                try {
                    const client = new ApiClient(config.apiKey);
                    const response = await client.review({ patch, repositoryName: repoName, files, reviewSessionId });

                    let result = '';
                    if (hasConflicts) {
                        result += `**Warning:** Merge conflicts detected with ${targetBranch}. Review results may not reflect the final merged state.\n\n`;
                    }
                    result += `Comparing against: ${targetBranch}\n\n`;
                    result += formatReview(response);

                    return { content: [{ type: 'text' as const, text: result }] };
                } finally {
                    progressService.endSession();
                }
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: review_diff_file
    (server.tool as any)(
        'review_diff_file',
        'Review an arbitrary diff/patch file. Sends the contents of a diff file for AI code review.',
        ReviewDiffFileSchema,
        async ({ file_path }: { file_path: string }, extra: any) => {
            try {
                const config = await readConfig();

                const patch = await git.readDiffFile(file_path);

                if (!patch.trim()) {
                    return { content: [{ type: 'text' as const, text: 'The diff file is empty. Nothing to review.' }] };
                }

                // Start progress session
                const progressService = new ReviewProgressService();
                const reviewSessionId = await progressService.startSession((event: ReviewProgressEvent) => {
                    safeSendLog(extra, 'optibot', formatProgressStep(event));
                });

                try {
                    const client = new ApiClient(config.apiKey);
                    const response = await client.review({ patch, reviewSessionId });
                    return { content: [{ type: 'text' as const, text: formatReview(response) }] };
                } finally {
                    progressService.endSession();
                }
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
