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
- **Run AI security scans** — trigger token-metered scans on any repo in your org and get the full markdown report back
- **Manage organizations** — switch the active org for multi-org accounts
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
| "what's my Optibot status?" | Shows auth method, profile, active org, and daily quota |
| "which Optibot organizations do I have?" | Lists all orgs (active marked with `*`) |
| "switch Optibot to the Acme org" | Rescopes your token to that org |
| "run a security scan on org/repo-a" | Triggers an AI security scan and returns the full report |
| "show me recent security scans" | Lists recent scans with cost and severity |
| "how much have we spent on scans this month?" | Shows current-month token usage and cost |
| "create an API key for CI" | Creates and displays a new API key |
| "list my API keys" | Lists all API keys with metadata |

## Available Tools

### Review

| Tool | Description |
|------|-------------|
| `review_local_changes` | Review uncommitted local changes (git diff HEAD) |
| `review_agent` | Agent-mode review of uncommitted local changes — returns structured findings (severity, category, confidence, stable ids) plus a signal-vs-noise rubric for the host to classify |
| `review_branch` | Review changes against a target branch (auto-detects or specify) |
| `review_diff_file` | Review an arbitrary diff/patch file |

#### Agent review mode (`review_agent`)

`review_agent` is built for a coding-agent host that already holds the working copy and will act on the results. Unlike the prose-style `review_local_changes`, it returns **structured findings** in a single synchronous pass, with no server-side tools — the changed files are front-loaded with the diff so the reviewer has everything it needs.

Each finding carries a stable `id`, `severity` (`blocker` / `warning` / `nit`), `category`, `file:line`, `message`, an optional `suggestedFix`, and a `confidence` score (1-10). The stable `id` is a hash of the file, category, and normalized message (not line numbers), so it stays the same across re-runs and lets the host say "same finding as last round."

The tool's output ends with a **signal-vs-noise self-assessment** step: because the MCP cannot itself judge whether a finding is real (that needs the working copy), it renders a structural severity breakdown, lists every finding, and hands the host the classification rubric. The host opens the cited lines, labels each finding as a real issue, a valid suggestion, or noise, then prints the signal-to-noise bar (industry trust threshold is roughly 5:1).

##### Pre-attaching extra context

`review_agent` accepts two optional inputs so you can hand the reviewer context that is not part of the diff:

| Input | Type | Purpose |
|-------|------|---------|
| `relatedPaths` | `string[]` | Repo-relative paths of extra files the reviewer should read — callers, interfaces, or tests that the changed code depends on but that are not themselves changed. The tool reads each from disk and sends it as related context. Files that cannot be read (missing, outside the repo, potentially sensitive, or binary) are skipped, and a `Context warnings:` block is prepended to the output naming each one. |
| `diagnosticsPath` | `string` | Repo-relative path to a local `tsc`/`eslint`/LSP output file. The tool reads it as plain text and passes it to the reviewer as local diagnostics. If it cannot be read, the tool warns and continues rather than failing. |

Both are optional; with neither, the tool behaves exactly as before.

##### Missing context is host-driven

`review_agent` is a **thin, single-shot primitive** — it never loops to fetch more context on its own. When the response includes `missingContext` (files the reviewer needed but was not given), the output lists those paths and prints a call-to-action telling you to **re-call `review_agent` with those paths in `relatedPaths`**, for example:

```
To let the reviewer see these, call `review_agent` again with `relatedPaths: ["src/db.ts", "src/user.ts"]`. Each re-run spends one review from your quota.
```

The host (which has an LLM) drives that resubmit — it reads the listed files and re-invokes the tool with `relatedPaths` — so the resubmit decision stays with the host, not buried inside the tool. Each re-run spends one review from your daily quota.

### Auth & status

| Tool | Description |
|------|-------------|
| `login` | Authenticate via browser OAuth (handles onboarding redirects; refuses inside CI environments) |
| `logout` | Remove saved credentials |
| `check_auth` | Check current authentication status |
| `get_status` | Full status: auth method, active org, daily quota |

### Organizations

| Tool | Description |
|------|-------------|
| `list_organizations` | List all organizations you belong to |
| `get_current_organization` | Show the active organization (read from the JWT claim) |
| `switch_organization` | Rescope your token to a different org (by id or name) |

### CI/CD setup

| Tool | Description |
|------|-------------|
| `setup_ci` | Recommended onboarding for CI/CD — mints a long-lived API key bound to the active organization and returns the export line ready to paste into the user's CI secret store. Refuses inside CI environments. |

### API keys

| Tool | Description |
|------|-------------|
| `create_api_key` | Create a new API key (lower-level primitive; prefer `setup_ci` for CI onboarding) |
| `list_api_keys` | List all API keys |
| `delete_api_key` | Delete an API key by ID |

> ⚠️ **Heads up:** `create_api_key` and `setup_ci` return the full secret in the tool output — by design, since you have to copy it. That output then lives in your AI host's conversation transcript (Claude Desktop, Cursor, etc.), which may be persisted, synced, or backed up. Copy the key into your CI secret store, then **delete the conversation or rotate the key with `delete_api_key`** if you don't want it lingering in transcript history.

### Security scans

| Tool | Description |
|------|-------------|
| `trigger_security_scan` | Start an AI security scan on a repo; blocks until complete (configurable timeout) |
| `list_security_scans` | Paginated list of recent scans (optionally filtered by repo) |
| `get_security_scan` | Full markdown report + metadata for a specific scan id |
| `get_security_usage` | Current-month token usage and cost |
| `get_security_pricing` | Per-tier pricing and markup multiplier |
| `list_scannable_repos` | Repositories available to scan in the active org |
| `get_security_config` | Scheduled-scan configuration |
| `update_security_config` | Update the scheduled-scan configuration (partial merge) |

## Real-Time Progress

During reviews and security scans, the MCP server connects to the Optibot backend via WebSocket and emits real-time progress notifications using MCP logging messages. Your MCP client will receive updates as the operation progresses.

**Reviews:**

1. **started** — Review request accepted
2. **analyzing_patch** — Parsing and analyzing the diff
3. **tool_call** — Running analysis tools (with tool name and query details)
4. **generating_review** — Generating the final review
5. **completed** — Review finished

**Security scans:**

1. **started** — Scan request accepted
2. **cloning_repository** — Fetching the repository
3. **scanning_code** — Running security analysis
4. **tool_call** — Individual analyzer tool invocations
5. **budget_update** — Running token + cost ticker
6. **generating_report** — Producing the final markdown report
7. **completed** / **failed** — Final status

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history. Security disclosures: [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Links

- [Optibot Website](https://getoptimal.ai/?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Sign Up (Free)](https://agents.getoptimal.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)
- [Report an Issue](https://github.com/Optimal-AI/optibot-mcp/issues)
- [Optibot CLI on npm](https://www.npmjs.com/package/@optimalai/optibot)
- [Optibot Claude Code Plugin](https://github.com/Optimal-AI/optibot-skill)
- [Twitter / X](https://x.com/optimaldotai)
- [LinkedIn](https://www.linkedin.com/company/optimaldotai/)
- [YouTube](https://www.youtube.com/@Optimaldotai)
- [Contact Us](https://getoptimal.ai/contact?utm_source=npm&utm_medium=readme&utm_campaign=optibot-mcp)

## License

MIT — see [LICENSE](LICENSE) for details.
Copyright (c) 2026 Optimal AI, Inc.
