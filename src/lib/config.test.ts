import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs/promises');

import * as fs from 'fs/promises';
import { readConfig, writeConfig, deleteConfig } from './config.js';

const CONFIG_DIR = path.join(os.homedir(), '.optibot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

describe('readConfig', () => {
    const originalEnv = process.env.OPTIBOT_API_KEY;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OPTIBOT_API_KEY;
        } else {
            process.env.OPTIBOT_API_KEY = originalEnv;
        }
    });

    it('returns config from OPTIBOT_API_KEY env var when set', async () => {
        process.env.OPTIBOT_API_KEY = 'env-test-key';
        const config = await readConfig();
        expect(config).toEqual({ apiKey: 'env-test-key' });
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('reads config from file when env var is not set', async () => {
        delete process.env.OPTIBOT_API_KEY;
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ apiKey: 'file-key' }));

        const config = await readConfig();
        expect(config).toEqual({ apiKey: 'file-key' });
        expect(fs.readFile).toHaveBeenCalledWith(CONFIG_FILE, 'utf-8');
    });

    it('throws when config file does not exist', async () => {
        delete process.env.OPTIBOT_API_KEY;
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        vi.mocked(fs.readFile).mockRejectedValue(err);

        await expect(readConfig()).rejects.toThrow('Not authenticated');
    });

    it('throws when apiKey is empty in config file', async () => {
        delete process.env.OPTIBOT_API_KEY;
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ apiKey: '' }));

        await expect(readConfig()).rejects.toThrow('API key not found in config');
    });

    it('throws when config file contains invalid JSON', async () => {
        delete process.env.OPTIBOT_API_KEY;
        vi.mocked(fs.readFile).mockResolvedValue('not-json');

        await expect(readConfig()).rejects.toThrow();
    });

    it('env var takes priority even when config file exists', async () => {
        process.env.OPTIBOT_API_KEY = 'env-priority';
        const config = await readConfig();
        expect(config.apiKey).toBe('env-priority');
        expect(fs.readFile).not.toHaveBeenCalled();
    });
});

describe('writeConfig', () => {
    it('creates directory and writes config file', async () => {
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        vi.mocked(fs.writeFile).mockResolvedValue(undefined);

        await writeConfig({ apiKey: 'new-key' });

        expect(fs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 });
        expect(fs.writeFile).toHaveBeenCalledWith(
            CONFIG_FILE,
            JSON.stringify({ apiKey: 'new-key' }, null, 2),
            { encoding: 'utf-8', mode: 0o600 }
        );
    });
});

describe('deleteConfig', () => {
    it('returns true when config file is deleted', async () => {
        vi.mocked(fs.rm).mockResolvedValue(undefined);
        expect(await deleteConfig()).toBe(true);
    });

    it('returns false when config file does not exist', async () => {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        vi.mocked(fs.rm).mockRejectedValue(err);
        expect(await deleteConfig()).toBe(false);
    });

    it('re-throws unexpected errors', async () => {
        const err: any = new Error('Permission denied');
        err.code = 'EACCES';
        vi.mocked(fs.rm).mockRejectedValue(err);
        await expect(deleteConfig()).rejects.toThrow('Permission denied');
    });
});
