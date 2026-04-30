# Changelog

## [1.3.0] - 2026-04-30

### Added — Guided CI onboarding

- **New tool: `setup_ci`** — mints a long-lived API key bound to the active organization and returns copy-paste YAML snippets for GitHub Actions and GitLab CI in a single structured response. Pair with `login` for users who just authenticated and need CI wiring.
- `check_auth` and `login` outputs now reference `setup_ci` so AI hosts route CI questions correctly.
- `create_api_key` result now includes the same YAML snippets so direct callers get the wiring without an extra round-trip.

### Internal

- New `src/lib/ci.ts` (CI env detection + YAML snippet renderers), mirrored from `optibot-cli` per the project rule that sibling client packages do not share code.

## [1.2.0] - 2026-04-21

### Added — Feature parity with the Optibot CLI

- **Organization management** — three new tools:
  - `list_organizations` — list all orgs you belong to; marks the active one
  - `get_current_organization` — shows the active org (read from the JWT `organizationId` claim)
  - `switch_organization` — rescopes the token to a different org (by id or name); replaces the stored JWT
- **Security scans** — eight new tools wrapping the backend's token-metered security-scan endpoints:
  - `trigger_security_scan` — starts a scan, streams live progress notifications, blocks until complete (configurable `timeoutSeconds`, default 300s); returns a `still_running` handoff on timeout
  - `list_security_scans`, `get_security_scan` — browse existing scans
  - `get_security_usage`, `get_security_pricing`, `list_scannable_repos` — read-only accessors
  - `get_security_config`, `update_security_config` — manage scheduled-scan configuration
- **`get_status`** — consolidated view matching `optibot status`: auth method, user profile, active organization, and daily review quota in a single tool call
- **Onboarding support** in `login` — when the backend returns `onboarding_required`, surfaces the setup URL instead of silently failing

### Changed — Auth endpoint migration

- Migrated from legacy `/vscode/*` endpoints to the canonical `/client/*` endpoints:
  - `/vscode/auth` → `/client/auth`
  - `/vscode/token` → `/client/token`
- New endpoints consumed: `/client/organizations`, `/client/token/rescope`
- Active organization id is now read from the JWT `organizationId` claim (single source of truth) and is never persisted separately
- `ApiClient.getUserProfile()` renamed to `ApiClient.getProfile()` to match the CLI
- `check_auth` now surfaces the active organization id (when present in the token)

### Security

- All server-provided strings in tool outputs (emails, org names, error messages, scan report content, etc.) are now stripped of ANSI escapes and control characters via `sanitizeServerText` before being returned in tool results. Tool results feed LLMs, so untrusted terminal escapes are a prompt-injection vector for the consuming model.

### Internal

- New helpers ported from `optibot-cli`: `SecurityScanProgressService` (WebSocket listener for `security-scan-progress`), `waitForScanCompletion` (polling helper for the 202-then-poll scan flow), `mapScanError` (structured error translation with a `ScanErrorKind` tag for LLM branching)
- New `src/lib/jwt.ts` helper for decoding the JWT payload without persisting it

## [1.1.0] - 2026-03-18

### Security

- Sensitive files (`.env*`, `*.pem`, `*.key`, credentials, etc.) are now skipped before uploading file contents for review, with a logged warning
- `OPTIBOT_API_URL` is now validated to use `https:` — setting a non-HTTPS URL throws a clear error to prevent accidental plain-text transmission of auth tokens and source code
- Source maps (`.js.map`) are excluded from the published npm package via `.npmignore`

### Changed

- Minimum Node.js version raised to `>=22.0.0` (Active LTS). Node 18 reached EOL in April 2025; Node 20 reaches EOL in April 2026.

## [1.0.0] - 2026-03-11

### Added

- MCP server with 10 tools for AI-powered code reviews
- Review tools: `review_local_changes`, `review_branch`, `review_diff_file`
- Auth tools: `login` (browser OAuth), `logout`, `check_auth`, `get_profile`
- API key management: `create_api_key`, `list_api_keys`, `delete_api_key`
- Real-time review progress notifications via WebSocket
- Support for Claude Desktop, Cursor, Windsurf, and Claude Code
- Stdio transport for standard MCP client integration
- Auto-detection of base branch (origin/main, origin/master, origin/develop)
- Non-destructive merge conflict detection
- Binary file detection by extension and content analysis
