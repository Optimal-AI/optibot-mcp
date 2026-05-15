import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

function readPackageVersion(): string {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        // src/lib at ts-node time, dist/lib after tsc — both sit two levels
        // below the package.json.
        const pkgPath = resolve(here, '..', '..', 'package.json');
        const raw = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
        return typeof raw.version === 'string' ? raw.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

const VERSION = readPackageVersion();

/**
 * Identification headers stamped on every outbound HTTP request to the
 * Optibot backend. Lets the backend distinguish CLI / MCP / IDE traffic
 * without user-agent sniffing.
 */
export const CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'X-Optibot-Client': 'mcp',
    'X-Optibot-Client-Version': VERSION,
});
