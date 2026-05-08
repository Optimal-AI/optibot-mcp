/**
 * Decode a JWT payload without verifying the signature.
 *
 * We use this to read the `organizationId` claim from a locally-stored token
 * so we know which org to act as, without ever persisting the id separately.
 * The token's signature is verified by the backend on every request — decoding
 * here is a local read, not a trust boundary.
 */
export interface JwtPayload {
    organizationId?: number;
    [key: string]: unknown;
}

export function decodeJwt(token: string): JwtPayload | null {
    if (typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '==='.slice((b64.length + 3) % 4);
        const json = Buffer.from(padded, 'base64').toString('utf-8');
        const parsed = JSON.parse(json) as unknown;
        if (parsed && typeof parsed === 'object') {
            return parsed as JwtPayload;
        }
        return null;
    } catch {
        return null;
    }
}

export function getOrganizationIdFromToken(token: string): number | null {
    const payload = decodeJwt(token);
    if (!payload) return null;
    const orgId = payload.organizationId;
    return typeof orgId === 'number' ? orgId : null;
}
