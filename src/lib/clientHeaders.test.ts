import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CLIENT_HEADERS } from './clientHeaders.js';

describe('CLIENT_HEADERS', () => {
  it('identifies this client as the MCP server', () => {
    expect(CLIENT_HEADERS['X-Optibot-Client']).toBe('mcp');
  });

  it('carries a non-empty version string', () => {
    const version = CLIENT_HEADERS['X-Optibot-Client-Version'];
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('matches the package.json version when readable', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(CLIENT_HEADERS['X-Optibot-Client-Version']).toBe(pkg.version);
  });

  it('is frozen — runtime mutations throw in strict mode', () => {
    expect(() => {
      (CLIENT_HEADERS as Record<string, string>)['X-Optibot-Client'] = 'cli';
    }).toThrowError();
  });
});
