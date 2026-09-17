import { describe, it, expect } from 'vitest';
import { sanitizeServerText, parseFileComments, formatReview, formatAgentReview, formatResetTime, formatError, hasReviewQuota, sanitizeAgentReviewResponse } from './output.js';
import { AgentReviewResponse, AgentReviewFinding } from '../types.js';

describe('sanitizeServerText', () => {
    it('passes through normal text unchanged', () => {
        expect(sanitizeServerText('Hello world')).toBe('Hello world');
    });

    it('strips ANSI color/cursor escape sequences', () => {
        expect(sanitizeServerText('\x1b[31mred\x1b[0m')).toBe('red');
        expect(sanitizeServerText('\x1b[2Jclear screen')).toBe('clear screen');
    });

    it('strips OSC escape sequences (title/clipboard injection)', () => {
        expect(sanitizeServerText('\x1b]0;evil title\x07normal text')).toBe('normal text');
    });

    it('strips null bytes and control characters', () => {
        expect(sanitizeServerText('hello\x00world')).toBe('helloworld');
        expect(sanitizeServerText('a\x01b\x02c')).toBe('abc');
    });

    it('preserves newlines and tabs', () => {
        expect(sanitizeServerText('line1\nline2\ttab')).toBe('line1\nline2\ttab');
    });

    it('preserves carriage returns', () => {
        expect(sanitizeServerText('line1\r\nline2')).toBe('line1\r\nline2');
    });
});

describe('parseFileComments', () => {
    it('parses a single well-formed file comment', () => {
        const input = [
            '---start-file-comment---src/app.ts-/-10-/-20---\nThis is a comment\n---end-file-comment---',
        ];
        const result = parseFileComments(input);
        expect(result).toEqual([
            { filePath: 'src/app.ts', startLine: 10, endLine: 20, comment: 'This is a comment' },
        ]);
    });

    it('parses multiple comments within a single string', () => {
        const input = [
            '---start-file-comment---a.ts-/-1-/-5---\nComment A\n---end-file-comment---\n' +
            '---start-file-comment---b.ts-/-10-/-20---\nComment B\n---end-file-comment---',
        ];
        const result = parseFileComments(input);
        expect(result).toHaveLength(2);
        expect(result[0].filePath).toBe('a.ts');
        expect(result[1].filePath).toBe('b.ts');
    });

    it('parses comments across multiple array elements', () => {
        const input = [
            '---start-file-comment---a.ts-/-1-/-5---\nFirst\n---end-file-comment---',
            '---start-file-comment---b.ts-/-10-/-20---\nSecond\n---end-file-comment---',
        ];
        const result = parseFileComments(input);
        expect(result).toHaveLength(2);
        expect(result[0].comment).toBe('First');
        expect(result[1].comment).toBe('Second');
    });

    it('handles multi-line comment text', () => {
        const input = [
            '---start-file-comment---file.ts-/-1-/-10---\nLine 1\nLine 2\nLine 3\n---end-file-comment---',
        ];
        const result = parseFileComments(input);
        expect(result[0].comment).toBe('Line 1\nLine 2\nLine 3');
    });

    it('returns empty array for empty input', () => {
        expect(parseFileComments([])).toEqual([]);
    });

    it('returns empty array when no comments match the regex', () => {
        expect(parseFileComments(['random text'])).toEqual([]);
    });

    it('correctly parses nested directory paths', () => {
        const input = [
            '---start-file-comment---src/components/Button.tsx-/-42-/-50---\nCheck this\n---end-file-comment---',
        ];
        const result = parseFileComments(input);
        expect(result[0].filePath).toBe('src/components/Button.tsx');
        expect(result[0].startLine).toBe(42);
        expect(result[0].endLine).toBe(50);
    });
});

describe('formatResetTime', () => {
    it('returns "soon" when reset time is in the past', () => {
        const pastDate = new Date(Date.now() - 60000).toISOString();
        expect(formatResetTime(pastDate)).toBe('soon');
    });

    it('returns minutes when less than an hour away', () => {
        const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        expect(formatResetTime(future)).toMatch(/^in \d+m$/);
    });

    it('returns hours and minutes when more than an hour away', () => {
        const future = new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString();
        expect(formatResetTime(future)).toMatch(/^in \d+h \d+m$/);
    });

    it('returns days when more than 24 hours away', () => {
        const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        expect(formatResetTime(future)).toMatch(/^in \d+d$/);
    });

    it('returns the raw string for invalid dates', () => {
        expect(formatResetTime('not-a-date')).toBe('not-a-date');
    });
});

describe('formatReview', () => {
    it('formats general comment', () => {
        const output = formatReview({ generalComment: 'Looks good' });
        expect(output).toContain('## Review Summary');
        expect(output).toContain('Looks good');
    });

    it('formats file comments', () => {
        const output = formatReview({
            fileComments: [
                '---start-file-comment---src/app.ts-/-1-/-5---\nFix this\n---end-file-comment---',
            ],
        });
        expect(output).toContain('## File Comments');
        expect(output).toContain('src/app.ts');
        expect(output).toContain('Fix this');
    });

    it('formats review count', () => {
        const output = formatReview({
            reviewCount: { current: 3, limit: 100, remaining: 97 },
        });
        expect(output).toContain('3/100');
        expect(output).toContain('97 remaining');
    });

    it('includes reset time in review count when resetAt is provided', () => {
        const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const output = formatReview({
            reviewCount: { current: 3, limit: 100, remaining: 97, resetAt: future },
        });
        expect(output).toContain('Resets in');
    });

    it('formats response with all fields', () => {
        const output = formatReview({
            generalComment: 'Summary here',
            fileComments: [
                '---start-file-comment---a.ts-/-1-/-2---\nComment\n---end-file-comment---',
            ],
            reviewCount: { current: 1, limit: 50, remaining: 49 },
        });
        expect(output).toContain('## Review Summary');
        expect(output).toContain('## File Comments');
        expect(output).toContain('1/50');
    });

    it('returns empty string for empty response', () => {
        expect(formatReview({})).toBe('');
    });

    it('skips file comments section when fileComments is empty array', () => {
        const output = formatReview({ fileComments: [] });
        expect(output).not.toContain('## File Comments');
    });

    it('skips file comments section when no comments match regex', () => {
        const output = formatReview({ fileComments: ['no match here'] });
        expect(output).not.toContain('## File Comments');
    });
});

describe('formatError', () => {
    it('returns auth failure message for status 401', () => {
        const msg = formatError({ status: 401 });
        expect(msg).toContain('Authentication failed');
    });

    it('returns rate limit message for status 429', () => {
        const msg = formatError({ status: 429 });
        expect(msg).toContain('Review Limit Reached');
        expect(msg).toContain('reached your review limit for today');
        expect(msg).toContain('getoptimal.ai/contact');
    });

    it('returns usage details for 429 when reviewCount is provided', () => {
        const msg = formatError({ status: 429, data: { reviewCount: { current: 5, limit: 5, remaining: 0 } } });
        expect(msg).toContain('You have used 5 of 5 reviews today');
    });

    it('returns formatted reset time for 429 when resetAt is provided', () => {
        const msg = formatError({ status: 429, data: { resetAt: '2024-06-01T14:30:00Z' } });
        expect(msg).toContain('Your limit will reset at');
    });

    it('returns seat assignment message for status 403', () => {
        const msg = formatError({ status: 403 });
        expect(msg).toContain('seat');
    });

    it('returns custom error message for 403 when provided', () => {
        const msg = formatError({ status: 403, data: { error: 'Custom 403 message' } });
        expect(msg).toContain('Custom 403 message');
    });

    it('returns upgrade message for status 402', () => {
        const msg = formatError({ status: 402 });
        expect(msg).toContain('upgrade');
    });

    it('returns generic error message for unknown status', () => {
        const msg = formatError({ status: 500, message: 'Server error' });
        expect(msg).toContain('Server error');
    });

    it('returns Unknown error when error has no message', () => {
        const msg = formatError({});
        expect(msg).toContain('Unknown error');
    });

    it('strips ANSI / control chars from server-supplied error messages', () => {
        const msg = formatError({ status: 500, message: '\x1b[31mBoom\x1b[0m\x1b]0;hijack\x07' });
        expect(msg).toBe('Error: Boom');
    });

    it('strips ANSI / control chars from server-supplied 403 messages', () => {
        const msg = formatError({ status: 403, data: { error: '\x1b[31mForbidden\x1b[0m\x07' } });
        expect(msg).toBe('Forbidden');
    });

    it('returns the trial-limit message with used count and upgrade URL for TRIAL_REVIEW_LIMIT_REACHED', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', limit: 30, used: 30, upgradeUrl: 'https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg).toContain('Trial review limit reached');
        expect(msg).toContain('used 30 of 30 code reviews');
        expect(msg).toContain('https://agents.getoptimal.ai/dashboard/billing');
    });

    it('falls back to limit-only trial phrasing when used is absent', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', limit: 30, upgradeUrl: 'https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg).toContain('all 30 code reviews');
        expect(msg).not.toContain('30 of 30');
    });

    it('falls back to limit-only trial phrasing when used is invalid', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', limit: 30, used: -1, upgradeUrl: 'https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg).toContain('all 30 code reviews');
        expect(msg).not.toContain('used -1');
    });

    it('returns the global-limit message with used count and contact URL for MAX_REVIEW_LIMIT_REACHED', () => {
        const msg = formatError({ status: 429, data: { code: 'MAX_REVIEW_LIMIT_REACHED', limit: 100, used: 100, contactUrl: 'https://getoptimal.ai/contact' } });
        expect(msg).toContain('Review limit reached');
        expect(msg).toContain('used 100 of 100 code reviews');
        expect(msg).toContain('https://getoptimal.ai/contact');
    });

    it('falls back to limit-only global phrasing when used is absent', () => {
        const msg = formatError({ status: 429, data: { code: 'MAX_REVIEW_LIMIT_REACHED', limit: 100, contactUrl: 'https://getoptimal.ai/contact' } });
        expect(msg).toContain('limit of 100 code reviews');
        expect(msg).not.toContain('used 100 of 100');
    });

    it('returns the trial-limit message without "undefined" when limit is missing', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', upgradeUrl: 'https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg.toLowerCase()).toContain('trial review limit');
        expect(msg).not.toContain('undefined');
    });

    it('returns the global-limit message without "undefined" when limit is missing', () => {
        const msg = formatError({ status: 429, data: { code: 'MAX_REVIEW_LIMIT_REACHED', contactUrl: 'https://getoptimal.ai/contact' } });
        expect(msg.toLowerCase()).toContain('review limit');
        expect(msg).not.toContain('undefined');
    });

    it('strips control-char injection from a server-supplied upgradeUrl (trial)', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', limit: 5, upgradeUrl: '\x1b]0;hijack\x07https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg).not.toContain('\x1b]0;');
        expect(msg).not.toContain('\x07');
        expect(msg).toContain('https://agents.getoptimal.ai/dashboard/billing');
    });

    it('strips control-char injection from a server-supplied contactUrl and limit (global)', () => {
        const msg = formatError({ status: 429, data: { code: 'MAX_REVIEW_LIMIT_REACHED', limit: '\x1b]0;x\x0742', contactUrl: '\x1b]0;hijack\x07https://getoptimal.ai/contact' } });
        expect(msg).not.toContain('\x1b]0;');
        expect(msg).not.toContain('\x07');
        expect(msg).toContain('https://getoptimal.ai/contact');
    });
});

describe('missingContext rendering', () => {
    const withMissing = (paths: string[]) => formatAgentReview({
        status: 'needs_changes',
        reviewPass: false,
        findings: [],
        summary: 's',
        missingContext: paths,
    } as never);

    it('renders an ordinary path in a code span', () => {
        expect(withMissing(['src/db.ts'])).toContain('`src/db.ts`');
    });

    it('keeps a finding id containing a backtick inside its code span', () => {
        const out = formatAgentReview({
            status: 'needs_changes',
            reviewPass: false,
            summary: 's',
            findings: [{
                id: 'AF-`evil', file: 'a.ts', startLine: 1, endLine: 1, inPatch: true,
                severity: 'blocker', category: 'bug', message: 'm', confidence: 9,
            }],
        } as never);
        // One backtick in the text, so the fence widens to two.
        expect(out).toContain('- **id:** ``AF-`evil``');
        expect(out).not.toContain('- **id:** `AF-`evil`');
    });

    it('keeps a path containing a backtick inside its code span', () => {
        // sanitizeServerText strips control characters, not markdown, so a
        // backtick in a server-supplied path would otherwise close the span.
        const out = withMissing(['we`ird.ts']);
        expect(out).toContain('``we`ird.ts``');
    });
});

describe('sanitizeAgentReviewResponse', () => {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    // Screen-clear plus an OSC 52 clipboard write — what a reviewer could quote
    // back from attacker-authored source in the repository under review.
    const evil = `${ESC}[2J${ESC}]52;c;cGF5bG9hZA==${BEL}text`;

    const response = {
        status: 'needs_changes',
        reviewPass: false,
        summary: `summary${evil}`,
        missingContext: [`ctx${evil}.ts`],
        meta: { mode: 'agent', durationMs: 1, model: `model${evil}`, provider: `prov${evil}` },
        findings: [{
            id: `AF${evil}`,
            file: `a${evil}.ts`,
            startLine: 1,
            endLine: 2,
            inPatch: true,
            severity: 'blocker',
            category: 'bug',
            message: evil,
            confidence: 9,
            suggestedFix: `fix${evil}`,
        }],
    } as never;

    it('strips escapes from every backend-supplied string', () => {
        const clean = sanitizeAgentReviewResponse(response);
        const f = clean.findings[0];
        const values = [
            clean.summary,
            clean.missingContext![0],
            clean.meta!.model!,
            clean.meta!.provider!,
            f.id, f.file, f.message, f.suggestedFix!,
        ];
        for (const value of values) {
            expect(value).not.toContain(ESC);
            expect(value).not.toContain(BEL);
        }
    });

    it('keeps the readable text and the non-string fields', () => {
        const clean = sanitizeAgentReviewResponse(response);
        const f = clean.findings[0];
        expect(f.message).toBe('text');
        expect(clean.summary).toBe('summarytext');
        expect(f.startLine).toBe(1);
        expect(f.confidence).toBe(9);
        expect(clean.reviewPass).toBe(false);
    });

    it('sanitizes a field the client does not know about', () => {
        // The service is a separate codebase: a string field added there before
        // this client's types catch up must still be cleaned.
        const withExtra = sanitizeAgentReviewResponse({
            status: 'looks_good', reviewPass: true, summary: 's', findings: [],
            futureField: `later${ESC}[2Jvalue`,
        } as never) as Record<string, unknown>;
        expect(withExtra.futureField).toBe('latervalue');
    });

    it('does not let a __proto__ key from the service set a prototype', () => {
        const payload = JSON.parse('{"status":"looks_good","reviewPass":true,"summary":"s","findings":[],"__proto__":{"polluted":true}}');
        const clean = sanitizeAgentReviewResponse(payload) as Record<string, unknown>;
        expect(Object.getPrototypeOf(clean)).toBeNull();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('sanitizes reviewCount.resetAt', () => {
        const clean = sanitizeAgentReviewResponse({
            status: 'looks_good', reviewPass: true, summary: 's', findings: [],
            reviewCount: { current: 1, limit: 5, remaining: 4, resetAt: `2026${ESC}[2J-01-01` },
        } as never);
        expect(clean.reviewCount!.resetAt).not.toContain(ESC);
    });

    it('leaves an absent optional field absent rather than inventing it', () => {
        const clean = sanitizeAgentReviewResponse({
            status: 'looks_good', reviewPass: true, summary: 's', findings: [],
        } as never);
        expect(clean.missingContext).toBeUndefined();
        expect(clean.meta).toBeUndefined();
        expect('suggestedFix' in (clean.findings[0] ?? {})).toBe(false);
    });
});

describe('markdown injection through server-supplied text', () => {
    const review = (over: Record<string, unknown>) => formatAgentReview({
        status: 'needs_changes', reviewPass: false, summary: 's', findings: [], ...over,
    } as never);

    const finding = (over: Record<string, unknown>) => ({
        id: 'AF-1', file: 'a.ts', startLine: 1, endLine: 1, inPatch: true,
        severity: 'blocker', category: 'bug', message: 'm', confidence: 9, ...over,
    });

    it('does not let a blank line in a missingContext path forge a new section', () => {
        // Markdown resolves block structure before inline spans, so a blank
        // line would end the list item and let a heading parse as real.
        const out = review({ missingContext: ['a.ts\n\n## Fake section\n\ninjected'] });
        expect(out).not.toMatch(/^## Fake section$/m);
        expect(out).toContain('injected');
    });

    it('does not let a blank line in a finding id forge a new section', () => {
        // A heading the renderer never emits itself, so a match can only come
        // from the injected text.
        const out = review({ findings: [finding({ id: 'AF-1\n\n### Injected Section\n\nfake' })] });
        expect(out).not.toMatch(/^### Injected Section$/m);
        expect(out).toContain('Injected Section');
    });

    it('widens the suggested-fix fence past a fenced block inside the fix', () => {
        const out = review({
            findings: [finding({ suggestedFix: 'before\n```\nescaped\n```\nafter' })],
        });
        // The opening fence must be longer than any run inside the fix.
        expect(out).toContain('````');
        const opening = out.split('\n').find((l) => /^`{4,}$/.test(l));
        expect(opening).toBeDefined();
    });

    it('leaves an ordinary suggested fix on a plain three-backtick fence', () => {
        const out = review({ findings: [finding({ suggestedFix: 'const x = 1;' })] });
        expect(out).toContain('```\nconst x = 1;\n```');
    });
});

describe('hasReviewQuota', () => {
    it('accepts a real ceiling', () => {
        expect(hasReviewQuota({ current: 3, limit: 50, remaining: 47 })).toBe(true);
    });

    it('rejects the service\'s unlimited sentinel', () => {
        expect(hasReviewQuota({
            current: 0,
            limit: Number.MAX_SAFE_INTEGER,
            remaining: Number.MAX_SAFE_INTEGER,
        })).toBe(false);
    });

    it('rejects a response missing remaining, which would render "undefined"', () => {
        expect(hasReviewQuota({ current: 3, limit: 50 } as never)).toBe(false);
    });

    it('rejects a non-finite number, which would render "NaN"', () => {
        expect(hasReviewQuota({ current: 3, limit: 50, remaining: NaN })).toBe(false);
        expect(hasReviewQuota({ current: 3, limit: Infinity, remaining: 5 })).toBe(false);
    });

    it('rejects an absent reviewCount', () => {
        expect(hasReviewQuota(undefined)).toBe(false);
    });
});

describe('formatAgentReview', () => {
    function makeFinding(overrides: Partial<AgentReviewFinding> = {}): AgentReviewFinding {
        return {
            id: 'AF-1a2b3c',
            file: 'src/auth.ts',
            startLine: 42,
            endLine: 45,
            inPatch: true,
            severity: 'blocker',
            category: 'bug',
            message: 'Missing null check reachable from the login path.',
            confidence: 8,
            ...overrides,
        };
    }

    function makeResponse(overrides: Partial<AgentReviewResponse> = {}): AgentReviewResponse {
        return {
            status: 'needs_changes',
            reviewPass: false,
            findings: [makeFinding()],
            summary: 'One blocker found.',
            reviewCount: { current: 1, limit: 50, remaining: 49 },
            isOptibotInstalled: true,
            meta: { mode: 'agent', durationMs: 8300 },
            ...overrides,
        };
    }

    it('renders the status header, summary, and finding count', () => {
        const out = formatAgentReview(makeResponse());
        expect(out).toContain('Optibot agent review');
        expect(out).toContain('Needs changes');
        expect(out).toContain('Findings: 1');
        expect(out).toContain('One blocker found.');
    });

    it('renders a looks_good status', () => {
        const out = formatAgentReview(makeResponse({ status: 'looks_good', reviewPass: true, findings: [], summary: '' }));
        expect(out).toContain('Looks good');
        expect(out).toContain('No findings');
    });

    it('renders severity + category + file:line + confidence + id for each finding', () => {
        const out = formatAgentReview(makeResponse());
        expect(out).toContain('[Blocker · bug] src/auth.ts:42-45');
        expect(out).toContain('confidence:** 8/10');
        expect(out).toContain('`AF-1a2b3c`');
        expect(out).toContain('Missing null check');
    });

    it('collapses a single-line range', () => {
        const out = formatAgentReview(makeResponse({ findings: [makeFinding({ startLine: 10, endLine: 10 })] }));
        expect(out).toContain('src/auth.ts:10');
        expect(out).not.toContain('src/auth.ts:10-10');
    });

    it('renders the suggested fix in a code block when present', () => {
        const out = formatAgentReview(makeResponse({ findings: [makeFinding({ suggestedFix: 'if (!user) return;' })] }));
        expect(out).toContain('Suggested fix');
        expect(out).toContain('if (!user) return;');
    });

    it('marks findings that fall outside the changed lines', () => {
        const out = formatAgentReview(makeResponse({ findings: [makeFinding({ inPatch: false })] }));
        expect(out).toContain('outside the changed lines');
    });

    it('includes the severity breakdown bar', () => {
        const out = formatAgentReview(makeResponse());
        expect(out).toContain('Severity breakdown');
        expect(out).toContain('Blocker');
        expect(out).toContain('1/1');
    });

    it('does not ask the host to classify findings as signal or noise', () => {
        const out = formatAgentReview(makeResponse());
        expect(out).not.toContain('Signal vs noise');
        expect(out).not.toContain('Signal-to-noise ratio');
        expect(out).not.toContain('| # | id | file:line | severity | verdict | why |');
    });

    it('lists missingContext with a re-run note', () => {
        const out = formatAgentReview(makeResponse({ missingContext: ['src/db.ts', 'src/user.ts'] }));
        expect(out).toContain('Missing context');
        expect(out).toContain('`src/db.ts`');
        expect(out).toContain('`src/user.ts`');
        expect(out).toContain('re-run');
    });

    it('renders a host-driven resubmit call-to-action with a relatedPaths literal', () => {
        const out = formatAgentReview(makeResponse({ missingContext: ['src/db.ts', 'src/user.ts'] }));
        expect(out).toContain('call `review_agent` again with');
        expect(out).toContain('relatedPaths: ["src/db.ts", "src/user.ts"]');
    });

    it('renders the review count footer', () => {
        const out = formatAgentReview(makeResponse());
        expect(out).toContain('Reviews used: 1/50 (49 remaining)');
    });

    it('echoes model and provider from meta when present', () => {
        const out = formatAgentReview(makeResponse({ meta: { mode: 'agent', durationMs: 5000, model: 'claude-sonnet-5', provider: 'anthropic' } }));
        expect(out).toContain('model: claude-sonnet-5');
        expect(out).toContain('provider: anthropic');
    });

    it('sanitizes control chars in server-supplied finding text', () => {
        const out = formatAgentReview(makeResponse({ findings: [makeFinding({ message: '\x1b[31mBoom\x1b[0m', file: 'src/x\x07.ts' })] }));
        expect(out).toContain('Boom');
        expect(out).not.toContain('\x1b');
        expect(out).not.toContain('\x07');
    });

    it('counts severities correctly across mixed findings', () => {
        const out = formatAgentReview(makeResponse({
            findings: [
                makeFinding({ id: 'a', severity: 'blocker' }),
                makeFinding({ id: 'b', severity: 'warning' }),
                makeFinding({ id: 'c', severity: 'nit' }),
                makeFinding({ id: 'd', severity: 'warning' }),
            ],
        }));
        expect(out).toContain('Findings: 4');
        expect(out).toMatch(/Blocker\s+\S+\s+\d+%\s+1\/4/);
        expect(out).toMatch(/Warning\s+\S+\s+\d+%\s+2\/4/);
        expect(out).toMatch(/Nit\s+\S+\s+\d+%\s+1\/4/);
    });
});
