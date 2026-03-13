# Changelog

## [1.0.0] - 2026-03-11

### Added

- MCP server with 9 tools for AI-powered code reviews
- Review tools: `review_local_changes`, `review_branch`, `review_diff_file`
- Auth tools: `login` (browser OAuth), `logout`, `check_auth`
- API key management: `create_api_key`, `list_api_keys`, `delete_api_key`
- Support for Claude Desktop, Cursor, Windsurf, and Claude Code
- Stdio transport for standard MCP client integration
- Auto-detection of base branch (origin/main, origin/master, origin/develop)
- Non-destructive merge conflict detection
- Binary file detection by extension and content analysis
