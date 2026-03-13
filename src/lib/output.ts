import { ReviewResponse, ParsedFileComment } from '../types.js';

const FILE_COMMENT_REGEX = /---start-file-comment---(.+?)-\/-(\d+)-\/-(\d+)---\n([\s\S]*?)(?:\n---end-file-comment---|$)/g;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function sanitizeServerText(text: string): string {
    return text.replace(CONTROL_CHARS_REGEX, '');
}

export function formatResetTime(resetAt: string): string {
    try {
        const resetDate = new Date(resetAt);
        if (isNaN(resetDate.getTime())) return resetAt;
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();

        if (diffMs <= 0) return 'soon';

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `in ${days}d`;
        }
        if (hours > 0) return `in ${hours}h ${minutes}m`;
        return `in ${minutes}m`;
    } catch {
        return resetAt;
    }
}

export function parseFileComments(fileComments: string[]): ParsedFileComment[] {
    const parsed: ParsedFileComment[] = [];

    for (const raw of fileComments) {
        FILE_COMMENT_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = FILE_COMMENT_REGEX.exec(raw)) !== null) {
            parsed.push({
                filePath: match[1],
                startLine: parseInt(match[2], 10),
                endLine: parseInt(match[3], 10),
                comment: match[4].trim(),
            });
        }
    }

    return parsed;
}

export function formatReview(response: ReviewResponse): string {
    const lines: string[] = [];

    if (response.generalComment) {
        lines.push('## Review Summary', '', sanitizeServerText(response.generalComment), '');
    }

    if (response.fileComments && response.fileComments.length > 0) {
        const comments = parseFileComments(response.fileComments);

        if (comments.length > 0) {
            lines.push('## File Comments', '');

            for (const c of comments) {
                lines.push(`### ${sanitizeServerText(c.filePath)} (lines ${c.startLine}-${c.endLine})`, '');
                lines.push(sanitizeServerText(c.comment), '');
            }
        }
    }

    if (response.reviewCount) {
        const rc = response.reviewCount;
        let line = `Reviews used: ${rc.current}/${rc.limit} (${rc.remaining} remaining)`;
        if (rc.resetAt) {
            line += ` · Resets ${formatResetTime(rc.resetAt)}`;
        }
        lines.push(`---`, line);
    }

    return lines.join('\n');
}

export function formatError(error: unknown): string {
    const err = error as any;
    const status = err?.status;

    if (status === 401) {
        return 'Authentication failed. Check that your API key is valid and starts with "optk_". Set OPTIBOT_API_KEY environment variable or use the login tool.';
    } else if (status === 429) {
        const reviewCount = err?.data?.reviewCount;
        const resetAt = err?.data?.resetAt;
        let msg = 'Review Limit Reached. ';

        if (reviewCount) {
            msg += `You have used ${reviewCount.current} of ${reviewCount.limit} reviews today. `;
        } else {
            msg += 'You have reached your review limit for today. ';
        }

        if (resetAt) {
            const resetDate = new Date(resetAt);
            if (!isNaN(resetDate.getTime())) {
                const time = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                const date = resetDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
                msg += `Your limit will reset at ${time} on ${date}. `;
            }
        }

        msg += 'If you need more reviews, contact us: https://getoptimal.ai/contact';
        return msg;
    } else if (status === 403) {
        return err?.data?.error || 'No seat assigned. Ask your organization owner to assign you a seat.';
    } else if (status === 402) {
        return 'Your plan does not include code reviews. Please upgrade.';
    }

    return `Error: ${err?.message || 'Unknown error'}`;
}
