import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readConfig } from '../lib/config.js';
import { ApiClient } from '../lib/api.js';
import { formatError, sanitizeServerText } from '../lib/output.js';
import {
    isCiEnvironment,
    renderGithubActionsYaml,
    renderGitlabCiYaml,
    renderGenericShell,
} from '../lib/ci.js';

const SetupCiSchema = {
    name: z.string().optional().describe('Name for the API key. Default: "ci".'),
};

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

type ToolWithSchema<S> = (
    name: string,
    description: string,
    schema: S,
    handler: (input: { [k: string]: unknown }) => Promise<ToolResult>,
) => void;

export async function handleSetupCi(input: { name?: string }): Promise<ToolResult> {
    let config;
    try {
        config = await readConfig();
    } catch {
        return {
            content: [{
                type: 'text',
                text: [
                    'Not authenticated.',
                    '',
                    'Use the `login` tool first, or set OPTIBOT_API_KEY.',
                    'Sign up at https://agents.getoptimal.ai/signup',
                ].join('\n'),
            }],
            isError: true,
        };
    }

    if (isCiEnvironment()) {
        return {
            content: [{
                type: 'text',
                text: 'CI environment detected. `setup_ci` is for setting up CI from a dev machine, not for use inside a CI runner. Run this on a developer\'s laptop.',
            }],
            isError: true,
        };
    }

    const client = new ApiClient(config.apiKey);
    const name = input.name?.trim() || 'ci';

    try {
        const result = await client.createApiKey(name);
        const apiKey = sanitizeServerText(result.key);
        const lines = [
            'API key created.',
            '',
            `Name:  ${sanitizeServerText(result.name)}`,
            `Key:   ${apiKey}`,
            '',
            'Save this key now — it will not be shown again.',
            '',
            'Export this in your shell or CI:',
            '',
            '```bash',
            `export OPTIBOT_API_KEY=${apiKey}`,
            '```',
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
            '',
            'Add this key to your CI provider\'s secret store as OPTIBOT_API_KEY. ' +
            'The key never expires; revoke it with the `delete_api_key` tool.',
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
        return { content: [{ type: 'text', text: formatError(err) }], isError: true };
    }
}

export function registerSetupCiTool(server: McpServer): void {
    (server.tool as unknown as ToolWithSchema<typeof SetupCiSchema>)(
        'setup_ci',
        'Set up Optibot for CI/CD: mints a long-lived API key and returns copy-paste YAML snippets for GitHub Actions and GitLab CI. The key is bound to the currently active organization. Use this for any "set up Optibot in CI" / GitHub Actions / GitLab CI / Jenkins question.',
        SetupCiSchema,
        async (input) => handleSetupCi(input as { name?: string }),
    );
}
