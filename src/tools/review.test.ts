import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Use hoisted mocks so they survive restoreMocks
const mockReadConfig = vi.fn();
const mockGetRepoRoot = vi.fn();
const mockGetRepoName = vi.fn();
const mockGetDiffHead = vi.fn();
const mockGetDiffBranch = vi.fn();
const mockReadDiffFile = vi.fn();
const mockGetChangedFiles = vi.fn();
const mockGetFileContents = vi.fn();
const mockGetRelatedFileContents = vi.fn();
const mockReadDiagnosticsFile = vi.fn();
const mockDetectBaseBranch = vi.fn();
const mockCheckMergeConflicts = vi.fn();
const mockFormatReview = vi.fn();
const mockFormatAgentReview = vi.fn();
const mockFormatError = vi.fn();
const mockApiReview = vi.fn();
// Produces the canned review that submitAgentReview resolves with. Not a
// method on ApiClient: the synchronous reviewAgent had no caller and was
// removed, so the mocked client no longer declares it either.
const mockApiReviewAgent = vi.fn();
const mockApiSubmitAgentReview = vi.fn();
const mockApiGetAgentReviewResult = vi.fn();
const mockStartSession = vi.fn();
const mockRunScout = vi.fn();
const SMALL_CHANGE_SCOUT = { files: [], meta: { durationMs: 0, files: [], skipped: true, reason: 'small_change' }, warnings: [] };
const mockEndSession = vi.fn();

vi.mock('../lib/config.js', () => ({
    readConfig: (...args: any[]) => mockReadConfig(...args),
}));

vi.mock('../lib/git.js', () => ({
    // createUploadBudget is a pure helper the tool threads through both file
    // reads; a mock returning undefined would break the call rather than
    // observe it, so the real one is used.
    createUploadBudget: (limit?: number) => {
        let spent = 0;
        const cap = limit ?? 25 * 1024 * 1024;
        return {
            canFit: (size: number) => spent + size <= cap,
            spend: (size: number) => { spent += size; },
            remaining: () => Math.max(0, cap - spent),
        };
    },
    getRepoRoot: (...args: any[]) => mockGetRepoRoot(...args),
    getRepoName: (...args: any[]) => mockGetRepoName(...args),
    getDiffHead: (...args: any[]) => mockGetDiffHead(...args),
    getDiffBranch: (...args: any[]) => mockGetDiffBranch(...args),
    readDiffFile: (...args: any[]) => mockReadDiffFile(...args),
    getChangedFiles: (...args: any[]) => mockGetChangedFiles(...args),
    getFileContents: (...args: any[]) => mockGetFileContents(...args),
    getRelatedFileContents: (...args: any[]) => mockGetRelatedFileContents(...args),
    readDiagnosticsFile: (...args: any[]) => mockReadDiagnosticsFile(...args),
    detectBaseBranch: (...args: any[]) => mockDetectBaseBranch(...args),
    checkMergeConflicts: (...args: any[]) => mockCheckMergeConflicts(...args),
}));

vi.mock('../lib/api.js', () => ({
    ApiClient: class {
        review(...args: any[]) { return mockApiReview(...args); }
        submitAgentReview(...args: any[]) { return mockApiSubmitAgentReview(...args); }
        getAgentReviewResult(...args: any[]) { return mockApiGetAgentReviewResult(...args); }
    },
}));

vi.mock('../lib/output.js', async (importOriginal) => {
    // The formatters are mocked so the tests can assert on calls, but
    // hasReviewQuota is a pure predicate the tool uses to decide what goes
    // into structuredContent; mocking it away would test nothing.
    const actual = await importOriginal<typeof import('../lib/output.js')>();
    return {
        formatReview: (...args: any[]) => mockFormatReview(...args),
        formatAgentReview: (...args: any[]) => mockFormatAgentReview(...args),
        formatError: (...args: any[]) => mockFormatError(...args),
        hasReviewQuota: actual.hasReviewQuota,
        sanitizeServerText: actual.sanitizeServerText,
        sanitizeAgentReviewResponse: actual.sanitizeAgentReviewResponse,
    };
});

vi.mock('../lib/scout.js', () => ({
    runScout: (...args: any[]) => mockRunScout(...args),
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
    let registeredToolConfigs: Map<string, any>;

    beforeEach(() => {
        registeredTools = new Map();
        registeredToolConfigs = new Map();

        const capture = (...args: any[]) => {
            const name = args[0] as string;
            const handler = args[args.length - 1] as Function;
            registeredTools.set(name, handler);
        };
        const server = {
            tool: vi.fn(capture),
            // review_agent registers through registerTool so it can declare an
            // outputSchema; the others still use tool().
            registerTool: vi.fn((name: string, config: any, handler: Function) => {
                registeredToolConfigs.set(name, config);
                capture(name, handler);
            }),
        } as any;

        registerReviewTools(server);
    });

    it('registers all review tools', () => {
        expect(registeredTools.has('review_local_changes')).toBe(true);
        expect(registeredTools.has('review_agent')).toBe(true);
        expect(registeredTools.has('review_branch')).toBe(true);
        expect(registeredTools.has('review_diff_file')).toBe(true);
    });

    const mockExtra = { sendNotification: vi.fn() };

    beforeEach(() => {
        mockStartSession.mockResolvedValue('session-id-123');
        // The tool submits with async:true. A backend without the async path
        // answers inline, so defaulting to the 'completed' shape keeps every
        // existing agent test observing the same params through
        // mockApiReviewAgent; the async describe overrides this.
        mockApiSubmitAgentReview.mockReset().mockImplementation(async (params: unknown) => ({
            kind: 'completed',
            review: await mockApiReviewAgent(params),
        }));
        mockApiGetAgentReviewResult.mockReset();
        mockRunScout.mockReset().mockResolvedValue(SMALL_CHANGE_SCOUT);
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

    describe('review_agent', () => {
        describe('context scout', () => {
            const review = { status: 'looks_good', reviewPass: true, summary: 's', findings: [], meta: { mode: 'agent', durationMs: 1200 } };
            const scouted = {
                files: [{ path: 'src/c.ts', content: 'c' }, { path: 'src/d.ts', content: 'd' }],
                reviewTicket: 'ticket-1',
                meta: { durationMs: 900, files: ['src/c.ts', 'src/d.ts'], skipped: false },
                warnings: [],
            };

            // The SDK validates structuredContent against the declared output
            // schema before a result leaves the server; this runs the same check.
            const expectValidOutput = (result: any) => {
                const schema = z.object(registeredToolConfigs.get('review_agent').outputSchema);
                expect(() => schema.parse(result.structuredContent)).not.toThrow();
            };

            beforeEach(() => {
                mockReadConfig.mockResolvedValue({ apiKey: 'key' });
                mockGetRepoRoot.mockResolvedValue('/repo');
                mockGetRepoName.mockResolvedValue('acme/app');
                mockGetDiffHead.mockResolvedValue('diff content');
                mockGetChangedFiles.mockResolvedValue([{ relativePath: 'a.ts', status: 'M' }]);
                mockGetFileContents.mockResolvedValue({ 'a.ts': 'contents' });
                mockGetRelatedFileContents.mockResolvedValue({ contents: { 'src/b.ts': 'b' }, warnings: [] });
                mockFormatAgentReview.mockReturnValue('rendered');
                mockApiSubmitAgentReview.mockReset().mockResolvedValue({ kind: 'completed', review });
            });

            it('scouts with the changed and related paths, then sends the scouted files and the ticket', async () => {
                mockRunScout.mockResolvedValue(scouted);

                const result: any = await registeredTools.get('review_agent')!({ relatedPaths: ['src/b.ts'] }, mockExtra);

                expect(mockRunScout).toHaveBeenCalledWith(
                    expect.anything(),
                    { patch: 'diff content', repositoryName: 'acme/app', providedPaths: ['a.ts', 'src/b.ts'] },
                    '/repo',
                    expect.objectContaining({ canFit: expect.any(Function) }),
                    mockExtra,
                );
                expect(mockApiSubmitAgentReview).toHaveBeenCalledWith(expect.objectContaining({
                    scoutedFiles: scouted.files,
                    reviewTicket: 'ticket-1',
                }));
                expect(result.structuredContent.meta).toEqual({
                    mode: 'agent',
                    durationMs: 1200,
                    scout: { durationMs: 900, files: ['src/c.ts', 'src/d.ts'], skipped: false },
                });
                expect(result.content[0].text).toContain('Context step: sent 2 more file(s) with the review: src/c.ts, src/d.ts');
                expectValidOutput(result);
            });

            it('shares one upload budget between the changed files, the related files, and the scout', async () => {
                await registeredTools.get('review_agent')!({ relatedPaths: ['src/b.ts'] }, mockExtra);

                const budget = mockGetFileContents.mock.calls[0][2];
                expect(mockGetRelatedFileContents.mock.calls[0][2]).toBe(budget);
                expect(mockRunScout.mock.calls[0][3]).toBe(budget);
            });

            it('reports a skipped scout in meta and adds no markdown line', async () => {
                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(result.structuredContent.meta.scout).toEqual({ durationMs: 0, files: [], skipped: true, reason: 'small_change' });
                expectValidOutput(result);
                expect(result.content[0].text).toBe('rendered');
            });

            it('adds meta.scout when the server sent no meta', async () => {
                mockApiSubmitAgentReview.mockResolvedValue({ kind: 'completed', review: { ...review, meta: undefined } });
                mockRunScout.mockResolvedValue(scouted);

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(result.structuredContent.meta).toEqual({ scout: scouted.meta });
                expectValidOutput(result);
            });

            it('skips the scout when scout is false, and reports no scout meta', async () => {
                const result: any = await registeredTools.get('review_agent')!({ scout: false }, mockExtra);

                expect(mockRunScout).not.toHaveBeenCalled();
                expect(mockApiSubmitAgentReview).toHaveBeenCalledWith(expect.objectContaining({ scoutedFiles: [], reviewTicket: undefined }));
                expect(result.structuredContent.meta).toEqual({ mode: 'agent', durationMs: 1200 });
                expectValidOutput(result);
            });

            it('passes the scout warnings on, stripped of control characters', async () => {
                mockRunScout.mockResolvedValue({ ...scouted, warnings: ['Skipped scouted file: it is ignored by git: \u001b[31mx.ts'] });

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(result.structuredContent.warnings).toEqual(['Skipped scouted file: it is ignored by git: x.ts']);
            });

            it('strips control characters from the scouted paths it reports', async () => {
                mockRunScout.mockResolvedValue({
                    ...scouted,
                    files: [{ path: 'src/\u0007c.ts', content: 'c' }],
                    meta: { ...scouted.meta, files: ['src/\u0007c.ts'] },
                });

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(result.structuredContent.meta.scout.files).toEqual(['src/c.ts']);
                expect(result.content[0].text).toContain('src/c.ts');
                expect(result.content[0].text).not.toContain('\u0007');
            });

            it('retries once without the scouted files after a 413, keeping the ticket', async () => {
                mockRunScout.mockResolvedValue(scouted);
                mockApiSubmitAgentReview
                    .mockRejectedValueOnce(Object.assign(new Error('Payload Too Large'), { status: 413, data: {} }))
                    .mockResolvedValueOnce({ kind: 'completed', review });

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(mockApiSubmitAgentReview).toHaveBeenCalledTimes(2);
                expect(mockApiSubmitAgentReview.mock.calls[1][0]).toEqual(expect.objectContaining({ scoutedFiles: [], reviewTicket: 'ticket-1' }));
                expect(result.isError).toBeUndefined();
                expect(result.structuredContent.meta.scout.files).toEqual([]);
                expect(result.structuredContent.warnings).toEqual([expect.stringContaining('too large')]);
                expect(result.content[0].text).not.toContain('Context step: sent');
                expectValidOutput(result);
            });

            it('does not retry a 413 that reports the context window', async () => {
                mockRunScout.mockResolvedValue(scouted);
                mockApiSubmitAgentReview.mockRejectedValue(Object.assign(new Error('too long'), {
                    status: 413,
                    data: { error: 'The diff is too large for the context window.' },
                }));
                mockFormatError.mockReturnValue('error text');

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(mockApiSubmitAgentReview).toHaveBeenCalledTimes(1);
                expect(result.isError).toBe(true);
            });

            it('does not retry a 413 when no scouted files were attached', async () => {
                mockApiSubmitAgentReview.mockRejectedValue(Object.assign(new Error('Payload Too Large'), { status: 413, data: {} }));
                mockFormatError.mockReturnValue('error text');

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(mockApiSubmitAgentReview).toHaveBeenCalledTimes(1);
                expect(result.isError).toBe(true);
            });

            it('does not retry any other error', async () => {
                mockRunScout.mockResolvedValue(scouted);
                mockApiSubmitAgentReview.mockRejectedValue(Object.assign(new Error('limit'), { status: 429, data: {} }));
                mockFormatError.mockReturnValue('error text');

                const result: any = await registeredTools.get('review_agent')!({}, mockExtra);

                expect(mockApiSubmitAgentReview).toHaveBeenCalledTimes(1);
                expect(result.isError).toBe(true);
            });

            it('declares the scout input and the scout meta in its schemas', () => {
                const config = registeredToolConfigs.get('review_agent');
                expect(config.inputSchema.scout).toBeDefined();
                expect(config.outputSchema.meta.unwrap().shape.scout).toBeDefined();
                expect(config.description).toContain('scout: false');
            });
        });

        it('returns formatted agent review on success', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([{ relativePath: 'a.ts', status: 'M' }]);
            mockGetFileContents.mockResolvedValue({ 'a.ts': 'contents' });
            mockApiReviewAgent.mockResolvedValue({ status: 'needs_changes', findings: [] });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.content[0].text).toBe('Agent review output');
            expect(result.isError).toBeUndefined();
            expect(mockApiReviewAgent).toHaveBeenCalledWith(
                expect.objectContaining({ patch: 'diff content', repositoryName: 'my-repo', files: { 'a.ts': 'contents' } })
            );
        });

        it('declares an output schema and returns the review as structured data', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            const review = {
                status: 'needs_changes',
                reviewPass: false,
                summary: 's',
                findings: [{ id: 'AF-1', file: 'a.ts', startLine: 1, endLine: 1, inPatch: true, severity: 'blocker', category: 'bug', message: 'm', confidence: 9 }],
            };
            mockApiSubmitAgentReview.mockResolvedValue({ kind: 'completed', review });
            mockFormatAgentReview.mockReturnValue('rendered');

            const config = registeredToolConfigs.get('review_agent');
            expect(config?.outputSchema).toBeDefined();
            expect(config?.inputSchema).toBeDefined();

            const result: any = await registeredTools.get('review_agent')!(mockExtra);

            expect(result.structuredContent).toMatchObject({
                status: 'needs_changes',
                reviewPass: false,
                findings: [expect.objectContaining({ id: 'AF-1' })],
            });
            expect(result.content[0].text).toBe('rendered');
        });

        it('does not let a newline in a caller path break out of the warnings block', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockReadDiagnosticsFile.mockRejectedValue(new Error('nope'));
            mockApiSubmitAgentReview.mockResolvedValue({
                kind: 'completed',
                review: { status: 'looks_good', reviewPass: true, summary: 's', findings: [] },
            });
            mockFormatAgentReview.mockReturnValue('rendered');

            const result: any = await registeredTools.get('review_agent')!({
                diagnosticsPath: 'evil\n\n## Injected Section\n\nbody',
            });

            const text: string = result.content[0].text;
            expect(text).not.toMatch(/^## Injected Section$/m);
            // The warning is still reported, on one line.
            expect(text).toContain('Injected Section');
            const warningLines = text.split('\n').filter((l) => l.startsWith('> - '));
            expect(warningLines).toHaveLength(1);
        });

        it('sanitizes the structured payload, not only the markdown', async () => {
            const ESC = String.fromCharCode(27);
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiSubmitAgentReview.mockResolvedValue({
                kind: 'completed',
                review: {
                    status: 'needs_changes',
                    reviewPass: false,
                    summary: `sum${ESC}[2Jx`,
                    findings: [{
                        id: 'AF-1', file: 'a.ts', startLine: 1, endLine: 1, inPatch: true,
                        severity: 'blocker', category: 'bug',
                        message: `${ESC}[2Jwiped`, confidence: 9,
                        suggestedFix: `${ESC}]52;c;cGF5bG9hZA==fix`,
                    }],
                },
            });
            mockFormatAgentReview.mockReturnValue('rendered');

            const result: any = await registeredTools.get('review_agent')!(mockExtra);

            const finding = result.structuredContent.findings[0];
            expect(finding.message).not.toContain(ESC);
            expect(finding.suggestedFix).not.toContain(ESC);
            expect(result.structuredContent.summary).not.toContain(ESC);
            expect(finding.message).toBe('wiped');
        });

        it('keeps the unlimited quota sentinel out of the structured data', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiSubmitAgentReview.mockResolvedValue({
                kind: 'completed',
                review: {
                    status: 'looks_good',
                    reviewPass: true,
                    summary: 's',
                    findings: [],
                    reviewCount: { current: 0, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER },
                },
            });
            mockFormatAgentReview.mockReturnValue('rendered');

            const result: any = await registeredTools.get('review_agent')!(mockExtra);

            expect(result.structuredContent.reviewCount).toBeUndefined();
            expect(JSON.stringify(result.structuredContent)).not.toContain('9007199254740991');
        });

        it('keeps a real quota in the structured data', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            const reviewCount = { current: 3, limit: 50, remaining: 47 };
            mockApiSubmitAgentReview.mockResolvedValue({
                kind: 'completed',
                review: { status: 'looks_good', reviewPass: true, summary: 's', findings: [], reviewCount },
            });
            mockFormatAgentReview.mockReturnValue('rendered');

            const result: any = await registeredTools.get('review_agent')!(mockExtra);

            expect(result.structuredContent.reviewCount).toEqual(reviewCount);
        });

        it('returns structured content for an empty diff too', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('   ');

            const result: any = await registeredTools.get('review_agent')!(mockExtra);

            expect(result.structuredContent).toEqual({
                status: 'looks_good',
                reviewPass: true,
                summary: 'No changes to review.',
                findings: [],
            });
        });

        it('polls for the result when the backend accepts the review (202)', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiSubmitAgentReview.mockResolvedValue({ kind: 'accepted', reviewId: 'apirev_1' });
            mockApiGetAgentReviewResult
                .mockResolvedValueOnce({ status: 'pending' })
                .mockResolvedValueOnce({ status: 'done', result: { status: 'looks_good', findings: [] } });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(mockApiGetAgentReviewResult).toHaveBeenCalledWith('apirev_1');
            expect(mockFormatAgentReview).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'looks_good' }),
            );
            expect(result.content[0].text).toBe('Agent review output');
            expect(result.isError).toBeUndefined();
        });

        it('backfills the quota snapshot from the 202 when the result carries none', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            const reviewCount = { current: 3, limit: 50, remaining: 47 };
            mockApiSubmitAgentReview.mockResolvedValue({ kind: 'accepted', reviewId: 'apirev_1', reviewCount });
            mockApiGetAgentReviewResult.mockResolvedValue({
                status: 'done',
                result: { status: 'looks_good', findings: [] },
            });
            mockFormatAgentReview.mockReturnValue('out');

            const handler = registeredTools.get('review_agent')!;
            await handler(mockExtra);

            expect(mockFormatAgentReview).toHaveBeenCalledWith(expect.objectContaining({ reviewCount }));
        });

        it('tells the host a diff was too large instead of passing the raw error through', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiSubmitAgentReview.mockResolvedValue({ kind: 'accepted', reviewId: 'apirev_1' });
            mockApiGetAgentReviewResult.mockResolvedValue({
                status: 'failed',
                error: 'sanitized text',
                errorType: 'context_window_exceeded',
            });
            mockFormatError.mockImplementation((err: any) => err.message);

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('too large');
        });

        it('tells the host the server stopped a long-running review', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiSubmitAgentReview.mockResolvedValue({ kind: 'accepted', reviewId: 'apirev_1' });
            mockApiGetAgentReviewResult.mockResolvedValue({
                status: 'failed',
                error: 'sanitized text',
                errorType: 'timeout',
            });
            mockFormatError.mockImplementation((err: any) => err.message);

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('ran too long');
        });

        it('returns "No changes" when diff is empty', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.content[0].text).toBe('No changes to review.');
            expect(mockApiReviewAgent).not.toHaveBeenCalled();
        });

        it('returns error when not authenticated', async () => {
            mockReadConfig.mockRejectedValue(new Error('Not authenticated'));
            mockFormatError.mockReturnValue('Auth error');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('Auth error');
        });

        it('returns error when the agent review API fails', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockApiReviewAgent.mockRejectedValue(new Error('API down'));
            mockFormatError.mockReturnValue('API error');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler(mockExtra);

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toBe('API error');
        });

        it('reads relatedPaths and passes them as relatedFiles to the API', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([{ relativePath: 'a.ts', status: 'M' }]);
            mockGetFileContents.mockResolvedValue({ 'a.ts': 'contents' });
            mockGetRelatedFileContents.mockResolvedValue({
                contents: { 'src/caller.ts': 'caller source' },
                warnings: [],
            });
            mockApiReviewAgent.mockResolvedValue({ status: 'needs_changes', findings: [] });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler({ relatedPaths: ['src/caller.ts'] }, mockExtra);

            expect(mockGetRelatedFileContents).toHaveBeenCalledWith(['src/caller.ts'], '/repo', expect.anything());
            expect(mockApiReviewAgent).toHaveBeenCalledWith(
                expect.objectContaining({ relatedFiles: { 'src/caller.ts': 'caller source' } })
            );
            expect(result.content[0].text).toBe('Agent review output');
        });

        it('prepends context warnings when a related file cannot be read', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockGetRelatedFileContents.mockResolvedValue({
                contents: {},
                warnings: ['Could not read related file: src/missing.ts'],
            });
            mockApiReviewAgent.mockResolvedValue({ status: 'looks_good', findings: [] });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler({ relatedPaths: ['src/missing.ts'] }, mockExtra);

            expect(result.content[0].text).toContain('Context warnings:');
            expect(result.content[0].text).toContain('Could not read related file: src/missing.ts');
            // No readable related files → relatedFiles is omitted entirely.
            expect(mockApiReviewAgent).toHaveBeenCalledWith(
                expect.not.objectContaining({ relatedFiles: expect.anything() })
            );
        });

        it('reads diagnosticsPath and passes it as localDiagnostics', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockReadDiagnosticsFile.mockResolvedValue('tsc: 2 errors');
            mockApiReviewAgent.mockResolvedValue({ status: 'needs_changes', findings: [] });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            await handler({ diagnosticsPath: 'build/tsc.log' }, mockExtra);

            expect(mockReadDiagnosticsFile).toHaveBeenCalledWith('build/tsc.log', '/repo', expect.anything());
            expect(mockApiReviewAgent).toHaveBeenCalledWith(
                expect.objectContaining({ localDiagnostics: 'tsc: 2 errors' })
            );
        });

        it('warns instead of failing when the diagnostics file cannot be read', async () => {
            mockReadConfig.mockResolvedValue({ apiKey: 'key' });
            mockGetRepoRoot.mockResolvedValue('/repo');
            mockGetRepoName.mockResolvedValue('my-repo');
            mockGetDiffHead.mockResolvedValue('diff content');
            mockGetChangedFiles.mockResolvedValue([]);
            mockGetFileContents.mockResolvedValue({});
            mockReadDiagnosticsFile.mockRejectedValue(new Error('ENOENT'));
            mockApiReviewAgent.mockResolvedValue({ status: 'looks_good', findings: [] });
            mockFormatAgentReview.mockReturnValue('Agent review output');

            const handler = registeredTools.get('review_agent')!;
            const result = await handler({ diagnosticsPath: 'missing.log' }, mockExtra);

            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toContain('Could not read diagnostics file "missing.log"');
            expect(mockApiReviewAgent).toHaveBeenCalledWith(
                expect.not.objectContaining({ localDiagnostics: expect.anything() })
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

        it('strips control characters from the tool name and query, which come from the reviewed repository', () => {
            expect(formatProgressStep({ step: 'tool_call', message: '', details: { tool: 'read\u001b[2Jfile', query: 'src/a\u001b[31m.ts' } }))
                .toBe('[progress] Running tool: readfile \u2014 src/a.ts');
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
