import { describe, it, expect } from 'vitest';
import { mapScanError, formatScanErrorForTool } from './scanErrors.js';

function apiError(status: number, data: Record<string, unknown> = {}, message?: string) {
    const err = new Error(message || `status ${status}`) as Error & { status: number; data: Record<string, unknown> };
    err.status = status;
    err.data = data;
    return err;
}

describe('mapScanError', () => {
    it('maps 400 to invalid_request with the message from data.error', () => {
        const info = mapScanError(apiError(400, { error: 'Bad repositoryId' }));
        expect(info.data.kind).toBe('invalid_request');
        expect(info.data.status).toBe(400);
        expect(info.humanMessage).toContain('Bad repositoryId');
    });

    it('maps 401 to unauthenticated with a login hint', () => {
        const info = mapScanError(apiError(401));
        expect(info.data.kind).toBe('unauthenticated');
        expect(info.hint).toContain('login');
    });

    it('maps 402 to insufficient_credits and surfaces balance + required', () => {
        const info = mapScanError(apiError(402, {
            error: 'Insufficient credits',
            currentBalanceUSD: 0.25,
            requiredUSD: 2.00,
            topUpUrl: 'https://example.com/top-up',
        }));
        expect(info.data.kind).toBe('insufficient_credits');
        expect(info.humanMessage).toContain('$0.25');
        expect(info.humanMessage).toContain('$2.00');
        expect(info.humanMessage).toContain('https://example.com/top-up');
    });

    it('maps 403 to forbidden with a switch_organization hint', () => {
        const info = mapScanError(apiError(403));
        expect(info.data.kind).toBe('forbidden');
        expect(info.hint).toContain('switch_organization');
    });

    it('maps 404 to not_found with a list_scannable_repos hint', () => {
        const info = mapScanError(apiError(404, { error: 'Repository 99 not found' }));
        expect(info.data.kind).toBe('not_found');
        expect(info.humanMessage).toContain('Repository 99 not found');
        expect(info.hint).toContain('list_scannable_repos');
    });

    it('maps 409 to conflict and includes active session details', () => {
        const info = mapScanError(apiError(409, {
            error: 'Scan already running',
            activeSessionId: 'sess-123',
            startedAt: '2026-04-21T10:00:00Z',
        }));
        expect(info.data.kind).toBe('conflict');
        expect(info.humanMessage).toContain('sess-123');
        expect(info.humanMessage).toContain('2026-04-21T10:00:00Z');
    });

    it('maps 429 to rate_limited', () => {
        const info = mapScanError(apiError(429));
        expect(info.data.kind).toBe('rate_limited');
    });

    it('maps 5xx to server_error', () => {
        const info = mapScanError(apiError(503, { error: 'upstream down' }));
        expect(info.data.kind).toBe('server_error');
        expect(info.humanMessage).toContain('503');
        expect(info.humanMessage).toContain('upstream down');
    });

    it('recognizes JSON parse errors as parse_error', () => {
        const info = mapScanError(new SyntaxError('Unexpected token < in JSON'));
        expect(info.data.kind).toBe('parse_error');
        expect(info.humanMessage).toContain('Unexpected response');
    });

    it('falls back to unknown for errors without a status', () => {
        const info = mapScanError(new Error('something weird'));
        expect(info.data.kind).toBe('unknown');
        expect(info.data.status).toBeNull();
        expect(info.humanMessage).toContain('something weird');
    });

    it('omits details when the data block is empty', () => {
        const info = mapScanError(apiError(400));
        expect(info.data.details).toBeUndefined();
    });
});

describe('formatScanErrorForTool', () => {
    it('joins humanMessage and hint with a blank line', () => {
        const info = mapScanError(apiError(401));
        const rendered = formatScanErrorForTool(info);
        expect(rendered).toMatch(/Authentication failed\.\n\n.*login/);
    });

    it('omits the hint block when hint is empty', () => {
        const info = mapScanError(new Error('naked'));
        const rendered = formatScanErrorForTool(info);
        expect(rendered).toBe('Error: naked');
    });
});
