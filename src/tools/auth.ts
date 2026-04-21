import * as http from 'http';
import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig, writeConfig, deleteConfig } from '../lib/config.js';
import { getApiBaseUrl } from '../lib/apiConfig.js';
import { ApiClient } from '../lib/api.js';
import { formatError, formatResetTime, sanitizeServerText } from '../lib/output.js';
import { getOrganizationIdFromToken } from '../lib/jwt.js';
import { AuthResponse, TokenResponse } from '../types.js';

const PORT = 8080;

async function startLocalServer(state: string): Promise<{ code: string; server: http.Server }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url || '', `http://localhost:${PORT}`);

            if (url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                const returnedState = url.searchParams.get('state');

                if (!code || returnedState !== state) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end('<h1>Authentication Failed</h1><p>Invalid or missing parameters.</p>');
                    reject(new Error('Invalid callback parameters'));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Authentication Successful</title>
                        <meta charset="utf-8">
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                background: #000000;
                            }
                            .container {
                                background: #1f1f1f;
                                padding: 3rem;
                                border-radius: 0.75rem;
                                border: 1px solid #374151;
                                text-align: center;
                                max-width: 400px;
                            }
                            .checkmark { font-size: 4rem; margin-bottom: 1rem; color: #CB96E8; }
                            h1 { color: #CB96E8; margin-bottom: 0.5rem; }
                            p { color: #9ca3af; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="checkmark">✓</div>
                            <h1>Authentication Successful!</h1>
                            <p>You can close this window and return to your editor.</p>
                        </div>
                    </body>
                    </html>
                `);

                resolve({ code, server });
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        server.listen(PORT, '127.0.0.1', () => {
            // Server ready — caller will open browser
        });

        server.on('error', (err) => {
            reject(err);
        });

        // Timeout after 5 minutes
        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('Authentication timeout — no callback received within 5 minutes.'));
        }, 5 * 60 * 1000);
        timeout.unref();
    });
}

async function exchangeCodeForToken(code: string, state: string): Promise<AuthResponse> {
    const API_BASE_URL = getApiBaseUrl();
    const response = await fetch(`${API_BASE_URL}/client/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
        throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }

    return await response.json() as AuthResponse;
}

function formatExpiry(expiresIn: number): string {
    const days = Math.floor(expiresIn / 86400);
    if (days > 0) return `${days}d`;
    const hours = Math.floor(expiresIn / 3600);
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor(expiresIn / 60);
    return `${minutes}m`;
}

export function registerAuthTools(server: McpServer): void {

    // Tool: login
    server.tool(
        'login',
        'Authenticate with Optibot via browser OAuth. Opens a browser window for login and saves credentials locally. Token expires after 90 days. If your account needs onboarding, returns a URL to complete setup before you can authenticate.',
        async () => {
            const state = crypto.randomBytes(32).toString('hex');
            const API_BASE_URL = getApiBaseUrl();

            let localServer: http.Server | null = null;
            try {
                const { code, server: srv } = await startLocalServer(state);
                localServer = srv;

                const authUrl = `${API_BASE_URL}/client/auth?state=${state}&scheme=http&port=${PORT}`;

                // Dynamic import for ESM-only package
                const { default: open } = await import('open');
                await open(authUrl);

                const authResponse = await exchangeCodeForToken(code, state);

                // Onboarding branch: backend says the user needs to finish setup
                // before we can issue a token. Do NOT save anything locally — the
                // user must revisit the URL and call `login` again after setup.
                if ('status' in authResponse && authResponse.status === 'onboarding_required') {
                    const url = sanitizeServerText(authResponse.onboardingUrl);
                    return {
                        content: [{
                            type: 'text' as const,
                            text: [
                                'Onboarding required before login can complete.',
                                '',
                                `Open: ${url}`,
                                '',
                                'Finish setup, then call the `login` tool again.',
                            ].join('\n'),
                        }],
                    };
                }

                const tokenData = authResponse as TokenResponse;
                await writeConfig({ apiKey: tokenData.token });

                const lines: string[] = ['Successfully authenticated!'];
                if (tokenData.user?.email) {
                    lines.push(`Logged in as: ${sanitizeServerText(tokenData.user.email)}`);
                }
                if (typeof tokenData.expiresIn === 'number') {
                    lines.push(`Token expires in ${formatExpiry(tokenData.expiresIn)}`);
                }

                // Surface org context so the LLM/host knows whether to offer
                // an org switch next. Prefer the claim from the JWT itself
                // (the authoritative source) over the top-level field.
                const orgId = getOrganizationIdFromToken(tokenData.token) ?? tokenData.organizationId;
                if (typeof orgId === 'number') {
                    try {
                        const client = new ApiClient(tokenData.token);
                        const orgs = await client.listOrganizations();
                        const active = orgs.organizations.find(o => o.id === orgId);
                        if (active) {
                            const label = sanitizeServerText(active.displayName || active.name);
                            lines.push(`Active organization: ${label}`);
                        }
                        if (orgs.organizations.length > 1) {
                            lines.push('');
                            lines.push(`You belong to ${orgs.organizations.length} organizations. Use \`list_organizations\` and \`switch_organization\` to change the active one.`);
                        }
                    } catch {
                        // Non-fatal: token is saved even if org lookup fails.
                    }
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Authentication failed';
                return { content: [{ type: 'text' as const, text: `Authentication failed: ${message}` }], isError: true };
            } finally {
                if (localServer) {
                    localServer.closeAllConnections();
                    localServer.close();
                }
            }
        }
    );

    // Tool: logout
    server.tool(
        'logout',
        'Remove saved Optibot credentials from this machine.',
        async () => {
            try {
                const deleted = await deleteConfig();
                if (deleted) {
                    return { content: [{ type: 'text' as const, text: 'Logged out successfully. Saved credentials have been removed.' }] };
                }
                return { content: [{ type: 'text' as const, text: 'Already logged out. No credentials found.' }] };
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return { content: [{ type: 'text' as const, text: `Logout failed: ${message}` }], isError: true };
            }
        }
    );

    // Tool: check_auth
    server.tool(
        'check_auth',
        'Check current Optibot authentication status. Shows whether credentials are configured via environment variable or config file, and the active organization (if any).',
        async () => {
            try {
                const envKey = process.env.OPTIBOT_API_KEY;
                const source = envKey ? 'OPTIBOT_API_KEY environment variable' : 'config file (~/.optibot/config.json)';
                const token = envKey || (await readConfig()).apiKey;

                const prefix = token.substring(0, Math.min(8, token.length));
                const lines: string[] = [
                    `Authenticated via ${source}.`,
                    `Key prefix: ${prefix}...`,
                ];

                const orgId = getOrganizationIdFromToken(token);
                if (typeof orgId === 'number') {
                    lines.push(`Active organization id (from token): ${orgId}`);
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch {
                return {
                    content: [{
                        type: 'text' as const,
                        text: 'Not authenticated.\n\nTo authenticate:\n1. Use the "login" tool to authenticate via browser\n2. Or set the OPTIBOT_API_KEY environment variable\n\nSign up at: https://agents.getoptimal.ai/signup'
                    }]
                };
            }
        }
    );

    // Tool: get_profile
    server.tool(
        'get_profile',
        'Get your Optibot user profile and review quota status. Shows email, profile info, and how many reviews you have remaining today.',
        async () => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);

                const [profile, reviewStatus] = await Promise.all([
                    client.getProfile(),
                    client.getReviewStatus(),
                ]);

                const lines: string[] = [
                    '## User Profile',
                    '',
                    `Email: ${sanitizeServerText(profile.email)}`,
                ];

                if (profile.name) {
                    lines.push(`Name: ${sanitizeServerText(profile.name)}`);
                }

                lines.push('', '## Review Quota', '');
                lines.push(`Used: ${reviewStatus.current} / ${reviewStatus.limit}`);
                lines.push(`Remaining: ${reviewStatus.remaining}`);

                if (reviewStatus.resetAt) {
                    lines.push(`Resets: ${formatResetTime(reviewStatus.resetAt)}`);
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
