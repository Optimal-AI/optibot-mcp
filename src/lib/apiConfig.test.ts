import { describe, it, expect, vi, afterEach } from 'vitest';
import { getApiBaseUrl } from './apiConfig.js';

describe('getApiBaseUrl', () => {
    const originalEnv = process.env.OPTIBOT_API_URL;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OPTIBOT_API_URL;
        } else {
            process.env.OPTIBOT_API_URL = originalEnv;
        }
    });

    it('returns default URL when OPTIBOT_API_URL is not set', () => {
        delete process.env.OPTIBOT_API_URL;
        expect(getApiBaseUrl()).toBe('https://agents.getoptimal.ai');
    });

    it('returns custom URL when OPTIBOT_API_URL is set', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.env.OPTIBOT_API_URL = 'https://custom.example.com';
        expect(getApiBaseUrl()).toBe('https://custom.example.com');
        spy.mockRestore();
    });

    it('returns the env value as-is including trailing slash', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.env.OPTIBOT_API_URL = 'https://custom.example.com/';
        expect(getApiBaseUrl()).toBe('https://custom.example.com/');
        spy.mockRestore();
    });

    it('logs a security warning when a custom API URL is used', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.env.OPTIBOT_API_URL = 'https://custom.example.com';
        getApiBaseUrl();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('[security]'));
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('https://custom.example.com'));
        spy.mockRestore();
    });

    it('throws when OPTIBOT_API_URL uses http (non-HTTPS)', () => {
        process.env.OPTIBOT_API_URL = 'http://example.com';
        expect(() => getApiBaseUrl()).toThrow('OPTIBOT_API_URL must use HTTPS');
    });

    it('throws when OPTIBOT_API_URL is not a valid URL', () => {
        process.env.OPTIBOT_API_URL = 'not-a-url';
        expect(() => getApiBaseUrl()).toThrow('OPTIBOT_API_URL is not a valid URL');
    });

    it('does not log a warning when using the default URL', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        delete process.env.OPTIBOT_API_URL;
        getApiBaseUrl();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('does not log a warning when env matches the default URL', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.env.OPTIBOT_API_URL = 'https://agents.getoptimal.ai';
        getApiBaseUrl();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
