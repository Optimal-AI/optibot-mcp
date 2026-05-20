# Changelog

## [1.4.0] - 2026-05-20

### Added

- Every backend request now carries `X-Optibot-Client: mcp` and `X-Optibot-Client-Version` headers so the backend can attribute traffic to a specific client and version.

## [1.3.2] - 2026-05-08

### Packaging

- The published npm package now includes `CHANGELOG.md` and `SECURITY.md` so version history and the disclosure policy are available offline alongside the install.
- README links the changelog and security policy.

## [1.3.1] - 2026-05-07

### Security & reliability

- Continued hardening across the MCP surface: stricter validation of caller-supplied input, additional defense-in-depth around the local OAuth callback, and tighter guardrails on outbound traffic when a custom `OPTIBOT_API_URL` is configured.
- Backend responses are sanitized before being returned in tool results, so the host AI only sees clean text.
- Per-review aggregate upload size is now capped (default 25 MB) so large or vendored repos don't send unnecessary data over the wire.
- Refreshed transitive dependencies; `npm audit` is clean.
- CI workflow uses pinned action versions and least-privilege permissions; Dependabot is enabled for npm and GitHub Actions.

### Reliability

- Progress notifications no longer disrupt the server when a host configuration doesn't accept them — the capability is now advertised explicitly and notification delivery is best-effort.
- `get_status` cleanly omits the review-quota section when the backend response doesn't include those fields, instead of rendering placeholders.

### Documentation

- README highlights that `create_api_key` and `setup_ci` output appears in your AI host's conversation transcript, with guidance on rotating the key after copying it into your CI secret store.
- New `SECURITY.md` describes how to report security issues privately.

## [1.3.0] - 2026-04-30

### Added — Guided CI onboarding

- **`setup_ci`** — recommended starting point for any "set up Optibot in CI" workflow. Mints a long-lived API key bound to the active organization and returns a copy-ready export line for your CI secret store. Refuses to run inside CI runners.
- `check_auth` and `login` now reference `setup_ci` so AI hosts route CI questions correctly.
- `create_api_key` results include the export line for direct callers.

### Removed

- `get_profile` — functionality is covered by `check_auth` (auth source + active org) and `get_status` (review quota).

## [1.2.0] - 2026-04-21

### Added — Feature parity with the Optibot CLI

- **Organization management:** `list_organizations`, `get_current_organization`, `switch_organization` — list, inspect, and rescope the active org.
- **Security scans (8 tools):** `trigger_security_scan`, `list_security_scans`, `get_security_scan`, `get_security_usage`, `get_security_pricing`, `list_scannable_repos`, `get_security_config`, `update_security_config`. Live progress notifications during a scan; configurable timeout with a "still running" handoff for long jobs.
- **`get_status`** — consolidated status view: auth method, active organization, and daily review quota in a single call.
- **Onboarding support** in `login` — when an account requires onboarding, the tool surfaces the setup URL instead of silently failing.

### Changed

- Migrated to the canonical `/client/*` auth endpoints.
- Active organization is read from the JWT claim (single source of truth) and not persisted separately.

### Security

- All server-provided strings (org names, error messages, scan reports, etc.) are sanitized before being returned in tool results.

## [1.1.0] - 2026-03-18

### Security

- Files commonly used to hold secrets (`.env*`, `*.pem`, `*.key`, credentials, etc.) are skipped when uploading code for review, with a logged notice.
- `OPTIBOT_API_URL` must use HTTPS; non-HTTPS values are rejected.
- Source maps are excluded from the published package.

### Changed

- Minimum Node.js version raised to `>=22.0.0` (Active LTS).

## [1.0.0] - 2026-03-11

### Added

- MCP server with 10 tools for AI-powered code reviews.
- Review tools: `review_local_changes`, `review_branch`, `review_diff_file`.
- Authentication: `login`, `logout`, `check_auth`, `get_profile`.
- API key management: `create_api_key`, `list_api_keys`, `delete_api_key`.
- Real-time review progress notifications.
- Support for Claude Desktop, Cursor, Windsurf, and Claude Code.
