/**
 * Maps API errors from ApiClient into structured, LLM-friendly error
 * payloads. Unlike the CLI, MCP tools don't use exit codes — errors are
 * returned as `{ content, isError: true }` with a human message and a
 * structured data block the caller can reason about.
 */

export interface ScanErrorInfo {
    /** One-line human-readable summary, safe to render directly. */
    humanMessage: string;
    /** Recovery hint (e.g. "run optibot login") — may be empty. */
    hint: string;
    /** Structured payload suitable for programmatic inspection. */
    data: {
        error: string;
        status: number | null;
        /** Category tag so the LLM can branch without parsing the message. */
        kind: ScanErrorKind;
        details?: Record<string, unknown>;
    };
}

export type ScanErrorKind =
    | 'invalid_request'
    | 'unauthenticated'
    | 'insufficient_credits'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'rate_limited'
    | 'server_error'
    | 'parse_error'
    | 'unknown';

interface RawApiError {
    message?: string;
    status?: number;
    data?: Record<string, unknown>;
}

function fmtUsd(n: unknown): string {
    if (typeof n !== 'number' || Number.isNaN(n)) return 'unknown';
    return `$${n.toFixed(2)}`;
}

export function mapScanError(err: unknown): ScanErrorInfo {
    const e = err as RawApiError;
    const status = typeof e?.status === 'number' ? e.status : null;
    const data = e?.data ?? {};
    const apiMessage = typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : (typeof (data as { message?: unknown }).message === 'string'
            ? (data as { message: string }).message
            : (e?.message || 'Unknown error'));

    const detailsBlock = Object.keys(data).length > 0 ? data : undefined;

    if (status === 400) {
        return {
            humanMessage: `Invalid request: ${apiMessage}`,
            hint: '',
            data: { error: apiMessage, status, kind: 'invalid_request', details: detailsBlock },
        };
    }

    if (status === 401) {
        return {
            humanMessage: 'Authentication failed.',
            hint: 'Call the `login` tool to re-authenticate, or check OPTIBOT_API_KEY.',
            data: { error: apiMessage, status, kind: 'unauthenticated', details: detailsBlock },
        };
    }

    if (status === 402) {
        const balance = (data as { currentBalanceUSD?: unknown }).currentBalanceUSD;
        const required = (data as { requiredUSD?: unknown }).requiredUSD;
        const topUp = (data as { topUpUrl?: unknown }).topUpUrl;
        const lines = [
            'Insufficient AI credits to start this scan.',
            `  Current balance: ${fmtUsd(balance)}`,
            `  Required:        ${fmtUsd(required)}`,
        ];
        if (typeof topUp === 'string' && topUp.length > 0) {
            lines.push(`  Top up:          ${topUp}`);
        }
        return {
            humanMessage: lines.join('\n'),
            hint: 'Scans are billed by token usage against a prepaid balance. Call `get_security_pricing` for tier costs.',
            data: { error: apiMessage, status, kind: 'insufficient_credits', details: detailsBlock },
        };
    }

    if (status === 403) {
        return {
            humanMessage: 'Forbidden. You may not be a member of the active organization.',
            hint: 'Call `switch_organization` to change the active organization.',
            data: { error: apiMessage, status, kind: 'forbidden', details: detailsBlock },
        };
    }

    if (status === 404) {
        return {
            humanMessage: `Not found: ${apiMessage}`,
            hint: 'Call `list_scannable_repos` to list available repositories.',
            data: { error: apiMessage, status, kind: 'not_found', details: detailsBlock },
        };
    }

    if (status === 409) {
        const session = (data as { activeSessionId?: unknown }).activeSessionId;
        const started = (data as { startedAt?: unknown }).startedAt;
        const lines = ['A security scan is already running for this repository.'];
        if (typeof started === 'string') lines.push(`  Started at: ${started}`);
        if (typeof session === 'string') lines.push(`  Session id: ${session}`);
        return {
            humanMessage: lines.join('\n'),
            hint: 'Wait for the running scan to finish, then call `list_security_scans` to view results.',
            data: { error: apiMessage, status, kind: 'conflict', details: detailsBlock },
        };
    }

    if (status === 429) {
        return {
            humanMessage: 'Rate limited by the API.',
            hint: 'Wait and try again shortly.',
            data: { error: apiMessage, status, kind: 'rate_limited', details: detailsBlock },
        };
    }

    if (status !== null && status >= 500) {
        return {
            humanMessage: `Server error (${status}): ${apiMessage}`,
            hint: 'This is usually transient — try again in a minute.',
            data: { error: apiMessage, status, kind: 'server_error', details: detailsBlock },
        };
    }

    const isParseError =
        err instanceof SyntaxError ||
        (typeof apiMessage === 'string' &&
            (apiMessage.includes('Unexpected token') || apiMessage.includes('not valid JSON')));

    if (isParseError) {
        return {
            humanMessage: 'Unexpected response from the server.',
            hint: 'Try again, or call `get_status` to verify the connection.',
            data: { error: apiMessage, status, kind: 'parse_error', details: detailsBlock },
        };
    }

    return {
        humanMessage: `Error: ${apiMessage}`,
        hint: '',
        data: { error: apiMessage, status, kind: 'unknown', details: detailsBlock },
    };
}

/** Render a ScanErrorInfo as a compact human-readable block. */
export function formatScanErrorForTool(info: ScanErrorInfo): string {
    const lines = [info.humanMessage];
    if (info.hint) {
        lines.push('', info.hint);
    }
    return lines.join('\n');
}
