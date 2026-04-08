import * as http from 'http';
import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readConfig, writeConfig, deleteConfig } from '../lib/config.js';
import { getApiBaseUrl } from '../lib/apiConfig.js';
import { ApiClient } from '../lib/api.js';
import { formatError } from '../lib/output.js';
import { formatResetTime } from '../lib/output.js';

const PORT = 8080;

interface TokenResponse {
    token: string;
    expiresIn: number;
    user: {
        firebaseUserId: string;
        email: string;
        name?: string;
        avatarUrl?: string;
    };
}

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

async function exchangeCodeForToken(code: string, state: string): Promise<TokenResponse> {
    const API_BASE_URL = getApiBaseUrl();
    const response = await fetch(`${API_BASE_URL}/client/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json() as any;

    if (data.status === 'onboarding_required') {
        const err: any = new Error('Account setup required');
        err.code = 'ONBOARDING_REQUIRED';
        err.onboardingUrl = data.onboardingUrl;
        throw err;
    }

    return data as TokenResponse;
}

export function registerAuthTools(server: McpServer): void {

    // Tool: login
    server.tool(
        'login',
        'Authenticate with Optibot via browser OAuth. Opens a browser window for login and saves credentials locally. Token expires after 90 days.',
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

                const tokenData = await exchangeCodeForToken(code, state);
                await writeConfig({ apiKey: tokenData.token });

                let msg = 'Successfully authenticated!';
                if (tokenData.user.email) {
                    msg += `\nLogged in as: ${tokenData.user.email}`;
                }
                msg += `\nToken expires in ${Math.floor(tokenData.expiresIn / 86400)} days`;

                return { content: [{ type: 'text' as const, text: msg }] };
            } catch (err: any) {
                if (err.code === 'ONBOARDING_REQUIRED') {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Account setup required. Please open this URL to complete setup:\n\n${err.onboardingUrl}\n\nAfter completing setup, run the login tool again.`
                        }]
                    };
                }
                return { content: [{ type: 'text' as const, text: `Authentication failed: ${err.message}` }], isError: true };
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
            } catch (err: any) {
                return { content: [{ type: 'text' as const, text: `Logout failed: ${err.message}` }], isError: true };
            }
        }
    );

    // Tool: check_auth
    server.tool(
        'check_auth',
        'Check current Optibot authentication status. Shows whether credentials are configured via environment variable or config file.',
        async () => {
            try {
                const envKey = process.env.OPTIBOT_API_KEY;
                if (envKey) {
                    const prefix = envKey.substring(0, Math.min(8, envKey.length));
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Authenticated via OPTIBOT_API_KEY environment variable.\nKey prefix: ${prefix}...`
                        }]
                    };
                }

                const config = await readConfig();
                const prefix = config.apiKey.substring(0, Math.min(8, config.apiKey.length));
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Authenticated via config file (~/.optibot/config.json).\nKey prefix: ${prefix}...`
                    }]
                };
            } catch (err: any) {
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
                    client.getUserProfile(),
                    client.getReviewStatus(),
                ]);

                const lines: string[] = [
                    '## User Profile',
                    '',
                    `Email: ${profile.email}`,
                ];

                if (profile.name) {
                    lines.push(`Name: ${profile.name}`);
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
