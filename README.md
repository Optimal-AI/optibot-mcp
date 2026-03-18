# Optibot MCP Server — AI Code Reviews for Any Editor

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@optimalai/optibot-mcp)](https://www.npmjs.com/package/@optimalai/optibot-mcp)
[![CI](https://github.com/Optimal-AI/optibot-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Optimal-AI/optibot-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io/) server that brings [Optibot](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp) AI-powered code reviews to Claude Desktop, Cursor, Windsurf, Claude Code, and any MCP-compatible client.

Review local changes, compare branches, and get actionable feedback — all from your AI assistant.

> **What is MCP?**
> The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI assistants use external tools and data sources. Once you add this server, your assistant can run Optibot reviews on your behalf — just ask in natural language.

<!-- ## Demo -->
<!-- ![Optibot reviewing code in an editor](assets/demo.gif) -->

## What It Does

- **Review your code** — say "review my changes" and get an AI code review instantly
- **Compare branches** — "review my branch against main" triggers a full branch diff review
- **Review patch files** — point it at any `.patch` or `.diff` file
- **Manage API keys** — create, list, and delete keys for CI/CD automation
- **Detect merge conflicts** — warns you about conflicts before you review

## Install

```bash
npm install -g @optimalai/optibot-mcp
```

## Setup

### Claude Desktop

Add to your Claude Desktop configuration:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

Add to your Cursor MCP configuration:

- **Global (all projects):** `~/.cursor/mcp.json`
- **Project-level:** `.cursor/mcp.json` in your project root

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

### Windsurf

Add to your Windsurf MCP configuration (`~/.codeium/windsurf/mcp_config.json`):

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
claude mcp add optibot -e OPTIBOT_API_KEY=optk_your_key_here -- npx -y @optimalai/optibot-mcp
```

The `-e` flag stores the API key in the MCP server config so it is always available when Claude Code spawns the server, regardless of your shell environment.

## Authentication

### Option 1: API Key (Recommended for MCP)

Set the `OPTIBOT_API_KEY` environment variable in your MCP client configuration. You can generate a key from the [Optibot dashboard](https://agents.getoptimal.ai) or using the CLI:

```bash
npx @optimalai/optibot apikey create my-mcp-key
```

### Option 2: Browser Login

Use the `login` tool to authenticate via browser. This saves credentials to `~/.optibot/config.json` (90-day token).

## Usage

Once configured, just ask your AI assistant naturally:

| What you say | What happens |
|---|---|
| "review my changes" | Reviews uncommitted local changes |
| "review my branch against main" | Compares current branch against main |
| "review this diff file" | Reviews an arbitrary patch file |
| "check if I'm authenticated" | Shows current auth status |
| "create an API key for CI" | Creates and displays a new API key |
| "list my API keys" | Lists all API keys with metadata |

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
| `get_profile` | Get your user profile and review quota status |

## Real-Time Progress

During reviews, the MCP server connects to the Optibot backend via WebSocket and emits real-time progress notifications using MCP logging messages. Your MCP client will receive updates as the review progresses through these steps:

1. **started** — Review request accepted
2. **analyzing_patch** — Parsing and analyzing the diff
3. **tool_call** — Running analysis tools (with tool name and query details)
4. **generating_review** — Generating the final review
5. **completed** — Review finished

## CI/CD Integration

For automated reviews in CI/CD pipelines (GitHub Actions, GitLab CI, etc.), use the **[Optibot CLI](https://www.npmjs.com/package/@optimalai/optibot)** instead. The CLI is purpose-built for non-interactive environments and runs as a standard command-line tool.

The MCP server is designed to run inside AI assistants (Claude Desktop, Cursor, etc.) — it speaks the MCP stdio protocol and is not intended to be invoked directly in a pipeline.

**To use in CI:**

1. Generate an API key from the [Optibot dashboard](https://agents.getoptimal.ai) or with `create_api_key` tool
2. Add `OPTIBOT_API_KEY` as a repository secret
3. Use the CLI in your pipeline:

```yaml
# GitHub Actions
- name: Install Optibot CLI
  run: npm install -g @optimalai/optibot
- name: Run code review
  env:
    OPTIBOT_API_KEY: ${{ secrets.OPTIBOT_API_KEY }}
  run: optibot review --branch origin/${{ github.base_ref }}
```

See the [Optibot CLI README](https://www.npmjs.com/package/@optimalai/optibot) for full CI/CD setup instructions including GitLab CI.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPTIBOT_API_KEY` | Your API token (required for automated use) |
| `OPTIBOT_API_URL` | Custom backend URL (must use `https://`, defaults to `https://agents.getoptimal.ai`) |

## Requirements

- Node.js >= 22
- Git (for review tools)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Links

- [Optibot Website](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Sign Up (Free)](https://agents.getoptimal.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Report an Issue](https://github.com/Optimal-AI/optibot-mcp/issues)
- [Optibot CLI on npm](https://www.npmjs.com/package/optibot)
- [Optibot Claude Code Plugin](https://github.com/Optimal-AI/optibot-skill)
- [Twitter / X](https://x.com/optimaldotai)
- [LinkedIn](https://www.linkedin.com/company/optimaldotai/)
- [YouTube](https://www.youtube.com/@Optimaldotai)
- [Contact Us](https://getoptimal.ai/contact?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)

## License

MIT — see [LICENSE](LICENSE) for details.
Copyright (c) 2026 Optimal AI, Inc.
