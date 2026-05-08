const DEFAULT_API_URL = 'https://agents.getoptimal.ai';

// Best-effort heuristic: hostnames that are obviously not the production
// backend. Used only to add an extra warning line — we don't block, because
// some users legitimately tunnel to a dev backend.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
    /^localhost$/i,
    /^127\.\d+\.\d+\.\d+$/,
    /^10\.\d+\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^(::1|fc00:|fd00:|fe80:)/i,
];

function looksPrivateHost(hostname: string): boolean {
    // URL.hostname strips brackets from IPv6 addresses, so test directly.
    return PRIVATE_HOST_PATTERNS.some(re => re.test(hostname));
}

export function getApiBaseUrl(): string {
    const envUrl = process.env.OPTIBOT_API_URL;
    if (!envUrl || envUrl === DEFAULT_API_URL) {
        return DEFAULT_API_URL;
    }

    let parsed: URL;
    try {
        parsed = new URL(envUrl);
    } catch {
        throw new Error(`OPTIBOT_API_URL is not a valid URL: ${envUrl}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`OPTIBOT_API_URL must use HTTPS to protect auth tokens and source code. Got: ${parsed.protocol}`);
    }

    console.error(`[security] Using custom API URL: ${envUrl}. All traffic (including auth tokens and source code) will be sent there.`);
    if (looksPrivateHost(parsed.hostname)) {
        console.error(`[security] OPTIBOT_API_URL points at a private/loopback host (${parsed.hostname}). Make sure this is intentional — tokens and source code will be sent to that host.`);
    }
    return envUrl;
}
