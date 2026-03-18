const DEFAULT_API_URL = 'https://agents.getoptimal.ai';

export function getApiBaseUrl(): string {
    const envUrl = process.env.OPTIBOT_API_URL;
    if (!envUrl || envUrl === DEFAULT_API_URL) {
        return DEFAULT_API_URL;
    }

    try {
        const parsed = new URL(envUrl);
        if (parsed.protocol !== 'https:') {
            throw new Error(`OPTIBOT_API_URL must use HTTPS to protect auth tokens and source code. Got: ${parsed.protocol}`);
        }
    } catch (err: any) {
        if (err.message.startsWith('OPTIBOT_API_URL')) throw err;
        throw new Error(`OPTIBOT_API_URL is not a valid URL: ${envUrl}`);
    }

    console.error(`[security] Using custom API URL: ${envUrl}. All traffic (including auth tokens and source code) will be sent there.`);
    return envUrl;
}
