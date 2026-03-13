import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { formatError } from '../lib/output.js';

const CreateApiKeySchema = {
    name: z.string().describe('Name for the API key (e.g., "ci-github-actions", "jenkins-pipeline")'),
};

const DeleteApiKeySchema = {
    id: z.string().describe('ID of the API key to delete'),
};

export function registerApiKeyTools(server: McpServer): void {

    // Tool: create_api_key
    (server.tool as any)(
        'create_api_key',
        'Create a new Optibot API key for CI/CD or automation. The key is only shown once — copy it immediately.',
        CreateApiKeySchema,
        async ({ name }: { name: string }) => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const result = await client.createApiKey(name);

                return {
                    content: [{
                        type: 'text' as const,
                        text: [
                            'API key created successfully!',
                            '',
                            `Name:  ${result.name}`,
                            `Key:   ${result.key}`,
                            '',
                            'Copy this key now — it will not be shown again.',
                            '',
                            'To use in CI/CD, set as environment variable:',
                            `  export OPTIBOT_API_KEY=${result.key}`,
                        ].join('\n')
                    }]
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: list_api_keys
    server.tool(
        'list_api_keys',
        'List all Optibot API keys associated with your account.',
        async () => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const keys = await client.listApiKeys();

                if (keys.length === 0) {
                    return { content: [{ type: 'text' as const, text: 'No API keys found.' }] };
                }

                const lines: string[] = [`API Keys (${keys.length}):`, ''];

                for (const key of keys) {
                    lines.push(`**${key.name}**`);
                    lines.push(`  ID:      ${key.id}`);
                    lines.push(`  Prefix:  ${key.keyPrefix}`);
                    lines.push(`  Created: ${key.createdAt}`);
                    if (key.lastUsedAt) {
                        lines.push(`  Last used: ${key.lastUsedAt}`);
                    }
                    lines.push('');
                }

                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );

    // Tool: delete_api_key
    (server.tool as any)(
        'delete_api_key',
        'Delete an Optibot API key by ID. Use list_api_keys to find the ID.',
        DeleteApiKeySchema,
        async ({ id }: { id: string }) => {
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                await client.deleteApiKey(id);

                return { content: [{ type: 'text' as const, text: `API key ${id} deleted successfully.` }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
