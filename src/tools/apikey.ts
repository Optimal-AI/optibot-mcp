import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { formatError, sanitizeServerText } from '../lib/output.js';
import { renderGithubActionsYaml, renderGitlabCiYaml, renderGenericShell } from '../lib/ci.js';

const CreateApiKeySchema = {
    name: z.string().describe('Name for the API key (e.g., "ci-github-actions", "jenkins-pipeline")'),
};

const DeleteApiKeySchema = {
    id: z.string().describe('ID of the API key to delete'),
};

type ToolWithSchema<S> = (
    name: string,
    description: string,
    schema: S,
    handler: (input: { [k: string]: unknown }) => Promise<unknown>,
) => void;

export function registerApiKeyTools(server: McpServer): void {

    // Tool: create_api_key
    (server.tool as unknown as ToolWithSchema<typeof CreateApiKeySchema>)(
        'create_api_key',
        'Create a new Optibot API key for CI/CD or automation. The key is only shown once — copy it immediately.',
        CreateApiKeySchema,
        async (input) => {
            const { name } = input as { name: string };
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                const result = await client.createApiKey(name);

                const apiKey = sanitizeServerText(result.key);
                return {
                    content: [{
                        type: 'text' as const,
                        text: [
                            'API key created successfully!',
                            '',
                            `Name:  ${sanitizeServerText(result.name)}`,
                            `Key:   ${apiKey}`,
                            '',
                            'Copy this key now — it will not be shown again.',
                            '',
                            'To use in CI/CD, set as environment variable:',
                            `  export OPTIBOT_API_KEY=${apiKey}`,
                            '',
                            'GitHub Actions (`.github/workflows/optibot.yml`):',
                            '',
                            '```yaml',
                            renderGithubActionsYaml().trimEnd(),
                            '```',
                            '',
                            'GitLab CI (`.gitlab-ci.yml` job):',
                            '',
                            '```yaml',
                            renderGitlabCiYaml().trimEnd(),
                            '```',
                            '',
                            'Generic shell:',
                            '',
                            '```bash',
                            renderGenericShell({ apiKey }).trimEnd(),
                            '```',
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
                    lines.push(`**${sanitizeServerText(key.name)}**`);
                    lines.push(`  ID:      ${key.id}`);
                    lines.push(`  Prefix:  ${sanitizeServerText(key.keyPrefix)}`);
                    lines.push(`  Created: ${sanitizeServerText(key.createdAt)}`);
                    if (key.lastUsedAt) {
                        lines.push(`  Last used: ${sanitizeServerText(key.lastUsedAt)}`);
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
    (server.tool as unknown as ToolWithSchema<typeof DeleteApiKeySchema>)(
        'delete_api_key',
        'Delete an Optibot API key by ID. Use list_api_keys to find the ID.',
        DeleteApiKeySchema,
        async (input) => {
            const { id } = input as { id: string };
            // Sanitize the input echo — the id reaches both the LLM (in tool
            // results) and the network (URL-encoded by ApiClient). Strip
            // ANSI/control chars before either path so a hallucinated or
            // attacker-controlled id can't carry escape sequences into the
            // host's prompt context.
            const safeId = sanitizeServerText(id);
            try {
                const config = await readConfig();
                const client = new ApiClient(config.apiKey);
                await client.deleteApiKey(id);

                return { content: [{ type: 'text' as const, text: `API key ${safeId} deleted successfully.` }] };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
            }
        }
    );
}
