import { describe, it, expect } from 'vitest';
import { sanitizeServerText, parseFileComments, formatReview, formatResetTime, formatError } from './output.js';

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

    it('returns the trial-limit message with upgrade URL for TRIAL_REVIEW_LIMIT_REACHED', () => {
        const msg = formatError({ status: 429, data: { code: 'TRIAL_REVIEW_LIMIT_REACHED', limit: 30, upgradeUrl: 'https://agents.getoptimal.ai/dashboard/billing' } });
        expect(msg).toContain('Trial review limit reached');
        expect(msg).toContain('all 30 code reviews');
        expect(msg).toContain('https://agents.getoptimal.ai/dashboard/billing');
    });

    it('returns the global-limit message with contact URL for MAX_REVIEW_LIMIT_REACHED', () => {
        const msg = formatError({ status: 429, data: { code: 'MAX_REVIEW_LIMIT_REACHED', limit: 100, contactUrl: 'https://getoptimal.ai/contact' } });
        expect(msg).toContain('Review limit reached');
        expect(msg).toContain('limit of 100 code reviews');
        expect(msg).toContain('https://getoptimal.ai/contact');
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
});
