import { describe, it, expect } from 'vitest';

import { registerReviewTools } from './review.js';
import { registerAuthTools } from './auth.js';
import { registerApiKeyTools } from './apikey.js';
import { registerOrgTools } from './org.js';
import { registerStatusTool } from './status.js';
import { registerScanTools } from './scan.js';
import { registerSetupCiTool } from './setupCi.js';

// Every tool description and input description is read by each AI host that
// connects, and ships in the public package, so it describes what a tool does
// for the user and nothing about how the service works inside.
const INTERNAL_TERMS = [/server-side/i, /backend/i, /endpoint/i, /\bJWT\b/i, /websocket/i, /\bclaim\b/i, /grep_search|read_file/i];

function collectTexts(): Array<{ tool: string; text: string }> {
    const texts: Array<{ tool: string; text: string }> = [];
    const addSchema = (tool: string, schema: unknown) => {
        if (!schema || typeof schema !== 'object') return;
        for (const field of Object.values(schema as Record<string, { description?: string }>)) {
            if (field && typeof field.description === 'string') texts.push({ tool, text: field.description });
        }
    };
    const server = {
        tool: (...args: unknown[]) => {
            const [name, description, schema] = args as [string, unknown, unknown];
            if (typeof description === 'string') texts.push({ tool: name, text: description });
            addSchema(name, schema);
        },
        registerTool: (name: string, config: { description?: string; inputSchema?: unknown }) => {
            if (config.description) texts.push({ tool: name, text: config.description });
            addSchema(name, config.inputSchema);
        },
    };
    for (const register of [registerReviewTools, registerAuthTools, registerApiKeyTools, registerOrgTools, registerStatusTool, registerScanTools, registerSetupCiTool]) {
        register(server as never);
    }
    return texts;
}

describe('tool descriptions', () => {
    it('collects the descriptions of every registered tool', () => {
        expect(new Set(collectTexts().map((t) => t.tool)).size).toBeGreaterThan(20);
    });

    it.each(INTERNAL_TERMS.map((term) => [String(term), term] as const))('never mention %s', (_label, term) => {
        const offenders = collectTexts().filter((t) => term.test(t.text)).map((t) => `${t.tool}: ${t.text}`);

        expect(offenders).toEqual([]);
    });
});
