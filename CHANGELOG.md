# Changelog

## [1.3.1] - 2026-05-07

### Security

- **Sanitize backend error text before it reaches MCP tool output.** ANSI escapes / control chars in server-supplied error strings were flowing straight into `formatError()` and `mapScanError()` output and into MCP tool results that the host LLM ingests. Closes a prompt-injection vector that opens up if a custom `OPTIBOT_API_URL` is hostile or compromised.
- **Block git argument-injection on caller-supplied refs.** Branch names from `review_branch` are now validated against a strict ref-name whitelist (no leading `-`, no shell metas, no `..`) and every git invocation that takes a user-supplied ref now uses `--end-of-options`. `execFile` blocks shell injection but not argument injection — a value like `--upload-pack=evil` was previously parsed by git as an option.
- **No shell spawned for git in `lib/git.ts`.** All git invocations now use `execFile` directly with an argv array, no shell at all.
- **Harden the OAuth callback server.** State comparison switched to `crypto.timingSafeEqual`; non-GET methods rejected; `Host` header pinned to `127.0.0.1:8080` / `localhost:8080` (defense in depth against DNS-rebinding scenarios).
- **Warn on private-host `OPTIBOT_API_URL`.** When the env override points at loopback, RFC1918, or link-local addresses, a second `[security]` warning is logged on top of the existing custom-URL warning.
- **Cap aggregate upload size in `getFileContents`.** 25 MB soft cap across all uploaded file contents per review — stops a poorly-scoped repo from streaming hundreds of MB to the backend.
- **`npm audit fix`** — clears 8 transitive advisories (`path-to-regexp` ReDoS, `hono` cookie-name validation, `@hono/node-server` middleware bypass, `ip-address` XSS, etc.).
- **CI hygiene:** SHA-pin `actions/checkout` and `actions/setup-node`, set workflow-level `permissions: contents: read`, enable Dependabot for npm + github-actions.

### Documentation

- README now flags that `create_api_key` / `setup_ci` output lands in the host's conversation transcript and recommends rotating after copying.

### Removed (housekeeping)

- Untrack `.claude/settings.local.json` — it was tracked from before the gitignore rule was added; now matches the public-repo posture rule.

## [1.3.0] - 2026-04-30

### Removed

- **`get_profile` tool** — the underlying `/api/user/profile` backend endpoint was never implemented, so the tool always failed in practice. The data it returned (auth method + review quota) is already covered by `check_auth` and `get_status`.

### Added — Guided CI onboarding

- **New tool: `setup_ci`** — mints a long-lived API key bound to the active organization and returns the export line ready to paste into the user's CI secret store. Refuses inside CI environments (CI guard runs before auth check, mirroring the CLI). Pair with `login` for users who just authenticated and need CI wiring.
- `check_auth` and `login` outputs now reference `setup_ci` so AI hosts route CI questions correctly.
- `create_api_key` result now includes the export line so direct callers get the wiring in one round-trip.

### Internal

- New `src/lib/ci.ts` exporting `isCiEnvironment` (CI-runner env-var detection), mirrored from `optibot-cli` per the project rule that sibling client packages do not share code.

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
