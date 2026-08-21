import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import * as git from '../lib/git.js';
import { ApiClient } from '../lib/api.js';
import { formatReview, formatAgentReview, formatError } from '../lib/output.js';
import { ReviewProgressService, ReviewProgressEvent } from '../lib/reviewProgress.js';
import { safeSendLog } from '../lib/notify.js';

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
    // tools, this returns STRUCTURED findings (severity/category/confidence,
    // stable ids) as native JSON in a single synchronous pass — the server
    // runs no tools, so the caller front-loads the changed files. Designed for
    // a coding-agent host that can act on findings and re-run with more context.
    (server.tool as any)(
        'review_agent',
        'Agent-mode code review of uncommitted local changes (git diff HEAD). Returns structured findings (severity, category, confidence, stable ids) plus a signal-vs-noise rubric for the host to classify. Single synchronous pass, no server-side tools. Prefer this when a coding agent holds the working copy and will act on the findings. Optionally pass `relatedPaths` (extra context files beyond the diff) and `diagnosticsPath` (a local tsc/eslint output file). When a run reports "Missing context", re-call this tool with those paths in `relatedPaths`.',
        ReviewAgentSchema,
        async ({ relatedPaths, diagnosticsPath }: { relatedPaths?: string[]; diagnosticsPath?: string }, _extra: any) => {
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
                const response = await client.reviewAgent({ patch, repositoryName: repoName, files, relatedFiles, localDiagnostics });

                let text = formatAgentReview(response);
                if (warnings.length > 0) {
                    const warningBlock = ['> **Context warnings:**', ...warnings.map(w => `> - ${w}`)].join('\n');
                    text = `${warningBlock}\n\n${text}`;
                }
                return { content: [{ type: 'text' as const, text }] };
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
