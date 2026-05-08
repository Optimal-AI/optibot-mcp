#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReviewTools } from './tools/review.js';
import { registerAuthTools } from './tools/auth.js';
import { registerApiKeyTools } from './tools/apikey.js';
import { registerOrgTools } from './tools/org.js';
import { registerStatusTool } from './tools/status.js';
import { registerScanTools } from './tools/scan.js';
import { registerSetupCiTool } from './tools/setupCi.js';

// `logging: {}` advertises the logging capability so the SDK accepts our
// `notifications/message` events emitted by ReviewProgressService /
// SecurityScanProgressService. Without it, the very first progress event
// throws synchronously from inside the SDK and kills the process.
const server = new McpServer(
    {
        name: 'optibot',
        version: '1.3.2',
    },
    {
        capabilities: {
            logging: {},
        },
    },
);

registerReviewTools(server);
registerAuthTools(server);
registerApiKeyTools(server);
registerOrgTools(server);
registerStatusTool(server);
registerScanTools(server);
registerSetupCiTool(server);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Optibot MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
