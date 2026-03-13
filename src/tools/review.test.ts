import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Use hoisted mocks so they survive restoreMocks
const mockReadConfig = vi.fn();
const mockGetRepoRoot = vi.fn();
const mockGetRepoName = vi.fn();
const mockGetDiffHead = vi.fn();
const mockGetDiffBranch = vi.fn();
const mockReadDiffFile = vi.fn();
const mockGetChangedFiles = vi.fn();
const mockGetFileContents = vi.fn();
const mockDetectBaseBranch = vi.fn();
const mockCheckMergeConflicts = vi.fn();
const mockFormatReview = vi.fn();
const mockFormatError = vi.fn();
const mockApiReview = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
}));

vi.mock('../lib/git.js', () => ({
    getRepoRoot: (...args: any[]) => mockGetRepoRoot(...args),
    getRepoName: (...args: any[]) => mockGetRepoName(...args),
    getDiffHead: (...args: any[]) => mockGetDiffHead(...args),
    getDiffBranch: (...args: any[]) => mockGetDiffBranch(...args),
    readDiffFile: (...args: any[]) => mockReadDiffFile(...args),
    getChangedFiles: (...args: any[]) => mockGetChangedFiles(...args),
    getFileContents: (...args: any[]) => mockGetFileContents(...args),
    detectBaseBranch: (...args: any[]) => mockDetectBaseBranch(...args),
    checkMergeConflicts: (...args: any[]) => mockCheckMergeConflicts(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        review(...args: any[]) { return mockApiReview(...args); }
    },
}));

vi.mock('../lib/output.js', () => ({
    formatReview: (...args: any[]) => mockFormatReview(...args),
    formatError: (...args: any[]) => mockFormatError(...args),
}));

import { registerReviewTools } from './review.js';

describe('review tools', () => {
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

        registerReviewTools(server);
    });

    it('registers three review tools', () => {
        expect(registeredTools.has('review_local_changes')).toBe(true);
        expect(registeredTools.has('review_branch')).toBe(true);
        expect(registeredTools.has('review_diff_file')).toBe(true);
    });

    describe('review_local_changes', () => {
        it('returns formatted review on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockResolvedValue({ generalComment: 'Good' });
            mockFormatReview.mockReturnValue('Review output');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler({});

            expect(result.content[0].text).toBe('Review output');
            expect(result.isError).toBeUndefined();
        });

        it('returns "No changes" when diff is empty', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler({});

            expect(result.content[0].text).toBe('No changes to review.');
        });

        it('returns error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));
            mockFormatError.mockReturnValue('Auth error');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler({});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Auth error');
        });
    });

    describe('review_branch', () => {
        it('auto-detects branch when not provided', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockDetectBaseBranch.mockResolvedValue('origin/main');
            mockCheckMergeConflicts.mockResolvedValue(false);
            mockGetDiffBranch.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review');

            const handler = registeredTools.get('review_branch')!;
            const result = await handler({});

            expect(mockDetectBaseBranch).toHaveBeenCalled();
            expect(result.content[0].text).toContain('origin/main');
        });

        it('uses provided branch name', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockCheckMergeConflicts.mockResolvedValue(false);
            mockGetDiffBranch.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review');

            const handler = registeredTools.get('review_branch')!;
            const result = await handler({ branch: 'develop' });

            expect(mockDetectBaseBranch).not.toHaveBeenCalled();
            expect(result.content[0].text).toContain('develop');
        });

        it('includes merge conflict warning', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockDetectBaseBranch.mockResolvedValue('origin/main');
            mockCheckMergeConflicts.mockResolvedValue(true);
            mockGetDiffBranch.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review');

            const handler = registeredTools.get('review_branch')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('Merge conflicts detected');
        });

        it('returns empty diff message when no changes', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockDetectBaseBranch.mockResolvedValue('origin/main');
            mockCheckMergeConflicts.mockResolvedValue(false);
            mockGetDiffBranch.mockResolvedValue('');

            const handler = registeredTools.get('review_branch')!;
            const result = await handler({});

            expect(result.content[0].text).toContain('No changes found');
        });
    });

    describe('review_diff_file', () => {
        it('reviews a diff file on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockResolvedValue('patch content');
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review output');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: 'changes.patch' });

            expect(result.content[0].text).toBe('Review output');
        });

        it('returns empty diff message for empty file', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockResolvedValue('   ');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: 'empty.patch' });

            expect(result.content[0].text).toContain('empty');
        });

        it('returns error for directory traversal', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockRejectedValue(new Error('Diff file must be within the current directory'));
            mockFormatError.mockReturnValue('Traversal error');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: '../../etc/passwd' });

            expect(result.isError).toBe(true);
        });
    });
});
