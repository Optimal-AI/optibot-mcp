#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReviewTools } from './tools/review.js';
import { registerAuthTools } from './tools/auth.js';
import { registerApiKeyTools } from './tools/apikey.js';
import { registerOrgTools } from './tools/org.js';

const server = new McpServer({
    name: 'optibot',
    version: '1.0.0',
});

registerReviewTools(server);
registerAuthTools(server);
registerApiKeyTools(server);
registerOrgTools(server);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Optibot MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
