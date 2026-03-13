import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CliConfig } from '../types.js';

const CONFIG_DIR = path.join(os.homedir(), '.optibot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function readConfig(): Promise<CliConfig> {
    // Env var takes priority
    const envKey = process.env.OPTIBOT_API_KEY;
    if (envKey) {
        return { apiKey: envKey };
    }

    try {
        const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(raw) as CliConfig;
        if (!config.apiKey) {
            throw new Error('API key not found in config');
        }
        return config;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            throw new Error(
                'Not authenticated. Set the OPTIBOT_API_KEY environment variable or use the login tool.'
            );
        }
        throw err;
    }
}

export async function writeConfig(config: CliConfig): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function deleteConfig(): Promise<boolean> {
    try {
        await fs.rm(CONFIG_FILE);
        return true;
    } catch (err: any) {
        if (err.code === 'ENOENT') return false;
        throw err;
    }
}
