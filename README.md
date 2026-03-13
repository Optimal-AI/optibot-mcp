# Optibot MCP Server

MCP (Model Context Protocol) server for AI-powered code reviews by [Optibot](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp). Works with Claude Desktop, Cursor, Windsurf, Claude Code, and any MCP-compatible client.

## Install

```bash
npm install -g @optimalai/optibot-mcp
```

## Setup

### Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "optibot": {
      "command": "npx",
      "args": ["-y", "@optimalai/optibot-mcp"],
      "env": {
        "OPTIBOT_API_KEY": "optk_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP configuration (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "optibot": {
      "command": "npx",
      "args": ["-y", "@optimalai/optibot-mcp"],
      "env": {
        "OPTIBOT_API_KEY": "optk_your_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add optibot -- npx -y @optimalai/optibot-mcp
```

Then set your API key as an environment variable:

```bash
export OPTIBOT_API_KEY=optk_your_key_here
```

## Authentication

### Option 1: API Key (Recommended for MCP)

Set the `OPTIBOT_API_KEY` environment variable in your MCP client configuration. You can generate a key from the [Optibot dashboard](https://agents.getoptimal.ai) or using the CLI:

```bash
npx @optimalai/optibot apikey create my-mcp-key
```

### Option 2: Browser Login

Use the `login` tool to authenticate via browser. This saves credentials to `~/.optibot/config.json`.

## Available Tools

| Tool | Description |
|------|-------------|
| `review_local_changes` | Review uncommitted local changes (git diff HEAD) |
| `review_branch` | Review changes against a target branch (auto-detects or specify) |
| `review_diff_file` | Review an arbitrary diff/patch file |
| `login` | Authenticate via browser OAuth |
| `logout` | Remove saved credentials |
| `check_auth` | Check current authentication status |
| `create_api_key` | Create a new API key for CI/CD |
| `list_api_keys` | List all API keys |
| `delete_api_key` | Delete an API key by ID |

## Usage Examples

Once configured, ask your AI assistant:

- "Review my local changes"
- "Review this branch against main"
- "Check if I'm authenticated with Optibot"
- "Create an API key called ci-deploy"
- "List my API keys"

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPTIBOT_API_KEY` | Your API token (required for automated use) |
| `OPTIBOT_API_URL` | Custom backend URL (defaults to `https://agents.getoptimal.ai`) |

## Requirements

- Node.js >= 18
- Git (for review tools)

## Related

- [@optimalai/optibot](https://www.npmjs.com/package/@optimalai/optibot) — CLI tool for direct terminal use
- [optibot-skill](https://github.com/Optimal-AI/optibot-skill) — Claude Code plugin
- [Optibot Website](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)

## Links

- [Website](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Sign Up](https://agents.getoptimal.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Twitter / X](https://x.com/optimaldotai)
- [LinkedIn](https://www.linkedin.com/company/optimaldotai/)
- [YouTube](https://www.youtube.com/@Optimaldotai)
- [Contact Us](https://getoptimal.ai/contact?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)

## License

MIT
