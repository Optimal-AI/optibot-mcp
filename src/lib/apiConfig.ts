const DEFAULT_API_URL = 'https://agents.getoptimal.ai';

export function getApiBaseUrl(): string {
    const envUrl = process.env.OPTIBOT_API_URL;
    if (envUrl && envUrl !== DEFAULT_API_URL) {
        console.error(`[security] Using custom API URL: ${envUrl}. All traffic (including auth tokens and source code) will be sent there.`);
    }
    return envUrl || DEFAULT_API_URL;
}
