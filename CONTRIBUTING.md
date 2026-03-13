# Contributing to Optibot MCP

Thanks for your interest in contributing!

## Reporting Issues

Open an issue on [GitHub](https://github.com/Optimal-AI/optibot-mcp/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- MCP client version (Claude Desktop, Cursor, etc.)
- Node.js version

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Run tests: `npm test`
5. Run coverage: `npm run test:coverage` (must meet 80% thresholds)
6. Commit your changes
7. Push to your fork and open a Pull Request

## Project Structure

```
optibot-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── types.ts          # TypeScript interfaces
│   ├── tools/            # MCP tool handlers
│   │   ├── review.ts     # Review tools
│   │   ├── auth.ts       # Authentication tools
│   │   └── apikey.ts     # API key management tools
│   └── lib/              # Shared libraries
│       ├── api.ts        # HTTP API client
│       ├── apiConfig.ts  # API URL configuration
│       ├── config.ts     # Local config management
│       ├── git.ts        # Git operations
│       └── output.ts     # Output formatting
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Guidelines

- Tests are co-located with source files (e.g., `api.ts` and `api.test.ts`)
- Coverage thresholds are 80% minimum for lines, functions, branches, and statements
- Use TypeScript strict mode
- No secrets in code or tests
- Update CHANGELOG.md for user-facing changes

## Questions?

Reach out at [support@getoptimal.ai](mailto:support@getoptimal.ai).
