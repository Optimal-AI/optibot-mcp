import { describe, it, expect } from 'vitest';
import { decodeJwt, getOrganizationIdFromToken } from './jwt.js';

function makeToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = 'signature';
    return `${header}.${body}.${sig}`;
}

describe('decodeJwt', () => {
    it('returns the parsed payload for a valid JWT', () => {
        const token = makeToken({ organizationId: 42, email: 'a@b.com' });
        expect(decodeJwt(token)).toEqual({ organizationId: 42, email: 'a@b.com' });
    });

    it('returns null for a malformed token (wrong number of parts)', () => {
        expect(decodeJwt('abc.def')).toBeNull();
        expect(decodeJwt('not-a-jwt')).toBeNull();
    });

    it('returns null when the payload is not valid JSON', () => {
        const body = Buffer.from('not json').toString('base64url');
        expect(decodeJwt(`h.${body}.s`)).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(decodeJwt(null as unknown as string)).toBeNull();
        expect(decodeJwt(undefined as unknown as string)).toBeNull();
    });

    it('handles base64url characters (- and _) in the payload', () => {
        const token = makeToken({ note: 'foo-bar_baz' });
        expect(decodeJwt(token)).toEqual({ note: 'foo-bar_baz' });
    });
});

describe('getOrganizationIdFromToken', () => {
    it('returns the organizationId when it is a number', () => {
        const token = makeToken({ organizationId: 7 });
        expect(getOrganizationIdFromToken(token)).toBe(7);
    });

    it('returns null when organizationId is missing', () => {
        const token = makeToken({ email: 'a@b.com' });
        expect(getOrganizationIdFromToken(token)).toBeNull();
    });

    it('returns null when organizationId is not a number', () => {
        const token = makeToken({ organizationId: 'not-a-number' });
        expect(getOrganizationIdFromToken(token)).toBeNull();
    });

    it('returns null for a malformed token', () => {
        expect(getOrganizationIdFromToken('garbage')).toBeNull();
    });
});
