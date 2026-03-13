import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import * as git from '../lib/git.js';
import { ApiClient } from '../lib/api.js';
import { formatReview, formatError } from '../lib/output.js';

const ReviewBranchSchema = {
    branch: z.string().optional().describe('Target branch to compare against. If omitted, auto-detects origin/main, origin/master, or origin/develop.'),
};

const ReviewDiffFileSchema = {
    file_path: z.string().describe('Path to the diff or patch file to review'),
};

export function registerReviewTools(server: McpServer): void {

    // Tool: review_local_changes
    server.tool(
        'review_local_changes',
        'Review uncommitted local changes (git diff HEAD). Runs an AI code review on all staged and unstaged changes in the current repository.',
        async () => {
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

                const client = new ApiClient(config.apiKey);
                const response = await client.review({ patch, repositoryName: repoName, files });

                return { content: [{ type: 'text' as const, text: formatReview(response) }] };
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
        async ({ branch }: { branch?: string }) => {
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

                const client = new ApiClient(config.apiKey);
                const response = await client.review({ patch, repositoryName: repoName, files });

                let result = '';
                if (hasConflicts) {
                    result += `**Warning:** Merge conflicts detected with ${targetBranch}. Review results may not reflect the final merged state.\n\n`;
                }
                result += `Comparing against: ${targetBranch}\n\n`;
                result += formatReview(response);

                return { content: [{ type: 'text' as const, text: result }] };
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
        async ({ file_path }: { file_path: string }) => {
            try {
                const config = await readConfig();

                const patch = await git.readDiffFile(file_path);

                if (!patch.trim()) {
                    return { content: [{ type: 'text' as const, text: 'The diff file is empty. Nothing to review.' }] };
                }

                const client = new ApiClient(config.apiKey);
                const response = await client.review({ patch });

                return { content: [{ type: 'text' as const, text: formatReview(response) }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
