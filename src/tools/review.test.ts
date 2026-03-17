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
const mockStartSession = vi.fn();
const mockEndSession = vi.fn();

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

vi.mock('../lib/reviewProgress.js', () => ({
    ReviewProgressService: class {
        startSession(...args: any[]) { return mockStartSession(...args); }
        endSession(...args: any[]) { return mockEndSession(...args); }
    },
    // Export the type as a no-op for imports
}));

import { registerReviewTools, formatProgressStep } from './review.js';

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

    const mockExtra = { sendNotification: vi.fn() };

    beforeEach(() => {
        mockStartSession.mockResolvedValue('session-id-123');
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
            const result = await handler(mockExtra);

            expect(result.content[0].text).toBe('Review output');
            expect(result.isError).toBeUndefined();
            expect(mockStartSession).toHaveBeenCalled();
            expect(mockEndSession).toHaveBeenCalled();
        });

        it('returns "No changes" when diff is empty', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler(mockExtra);

            expect(result.content[0].text).toBe('No changes to review.');
        });

        it('returns error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));
            mockFormatError.mockReturnValue('Auth error');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Auth error');
        });

        it('ends progress session even when review fails', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockRejectedValue(new Error('API down'));
            mockFormatError.mockReturnValue('API error');

            const handler = registeredTools.get('review_local_changes')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(mockEndSession).toHaveBeenCalled();
        });

        it('passes reviewSessionId to API client', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review');

            const handler = registeredTools.get('review_local_changes')!;
            await handler(mockExtra);

            expect(mockApiReview).toHaveBeenCalledWith(
                expect.objectContaining({ reviewSessionId: 'session-id-123' })
            );
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
            const result = await handler({}, mockExtra);

            expect(mockDetectBaseBranch).toHaveBeenCalled();
            expect(result.content[0].text).toContain('origin/main');
            expect(mockEndSession).toHaveBeenCalled();
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
            const result = await handler({ branch: 'develop' }, mockExtra);

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
            const result = await handler({}, mockExtra);

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
            const result = await handler({}, mockExtra);

            expect(result.content[0].text).toContain('No changes found');
        });

        it('returns error on failure', async () => {
            mockReadConfig.mockRejectedValue(new Error('Fail'));
            mockFormatError.mockReturnValue('Branch error');

            const handler = registeredTools.get('review_branch')!;
            const result = await handler({}, mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Branch error');
        });
    });

    describe('review_diff_file', () => {
        it('reviews a diff file on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockResolvedValue('patch content');
            mockApiReview.mockResolvedValue({});
            mockFormatReview.mockReturnValue('Review output');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: 'changes.patch' }, mockExtra);

            expect(result.content[0].text).toBe('Review output');
            expect(mockEndSession).toHaveBeenCalled();
        });

        it('returns empty diff message for empty file', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockResolvedValue('   ');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: 'empty.patch' }, mockExtra);

            expect(result.content[0].text).toContain('empty');
        });

        it('returns error for directory traversal', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockReadDiffFile.mockRejectedValue(new Error('Diff file must be within the current directory'));
            mockFormatError.mockReturnValue('Traversal error');

            const handler = registeredTools.get('review_diff_file')!;
            const result = await handler({ file_path: '../../etc/passwd' }, mockExtra);

            expect(result.isError).toBe(true);
        });
    });

    describe('formatProgressStep', () => {
        it('formats started step', () => {
            expect(formatProgressStep({ step: 'started', message: '' })).toBe('[progress] Review started');
        });

        it('formats analyzing_patch step without file count', () => {
            expect(formatProgressStep({ step: 'analyzing_patch', message: '' })).toBe('[progress] Analyzing patch');
        });

        it('formats analyzing_patch step with file count', () => {
            expect(formatProgressStep({ step: 'analyzing_patch', message: '', details: { fileCount: 5 } }))
                .toBe('[progress] Analyzing patch (5 files)');
        });

        it('formats tool_call step with tool name', () => {
            expect(formatProgressStep({ step: 'tool_call', message: '', details: { tool: 'lint' } }))
                .toBe('[progress] Running tool: lint');
        });

        it('formats tool_call step with tool and query', () => {
            expect(formatProgressStep({ step: 'tool_call', message: '', details: { tool: 'search', query: 'foo' } }))
                .toBe('[progress] Running tool: search \u2014 foo');
        });

        it('formats tool_call step without details', () => {
            expect(formatProgressStep({ step: 'tool_call', message: '' }))
                .toBe('[progress] Running tool: unknown');
        });

        it('formats generating_review step', () => {
            expect(formatProgressStep({ step: 'generating_review', message: '' })).toBe('[progress] Generating review');
        });

        it('formats completed step', () => {
            expect(formatProgressStep({ step: 'completed', message: '' })).toBe('[progress] Review completed');
        });

        it('formats unknown step with message', () => {
            expect(formatProgressStep({ step: 'other' as any, message: 'Custom event' })).toBe('[progress] Custom event');
        });
    });
});
