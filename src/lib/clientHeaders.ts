import { PACKAGE_VERSION } from './version.js';

/**
 * Identification headers stamped on every outbound HTTP request to the
 * Optibot backend. Lets the backend distinguish CLI / MCP / IDE traffic
 * without user-agent sniffing.
 */
export const CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'X-Optibot-Client': 'mcp',
    'X-Optibot-Client-Version': PACKAGE_VERSION,
});
