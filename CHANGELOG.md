# Changelog

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
