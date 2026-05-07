# Security Policy

## Reporting a vulnerability

If you've found a security issue in `@optimalai/optibot-mcp`, please report it
privately rather than opening a public GitHub issue.

- **Email:** [security@getoptimal.ai](mailto:security@getoptimal.ai)
- **Subject prefix:** `[optibot-mcp security]`
- Include: a description of the issue, reproduction steps, the version
  (`@optimalai/optibot-mcp@<version>`), and the impact you're worried about.

You can expect:

- Acknowledgement within 3 business days.
- A first assessment and severity within 7 business days.
- A coordinated disclosure once a fix is published. We credit reporters in the
  release notes unless you'd prefer to remain anonymous.

## Supported versions

Only the latest published `@optimalai/optibot-mcp` minor receives fixes.
We don't backport security fixes to older minors.

## Scope

In scope:

- The `@optimalai/optibot-mcp` npm package (this repo).
- Its OAuth callback flow, on-disk credential handling (`~/.optibot/config.json`),
  and tool surfaces.

Out of scope (report to the relevant project / vendor):

- The Optibot backend itself ([https://getoptimal.ai](https://getoptimal.ai)
  — please email security@getoptimal.ai with backend findings).
- The CLI (`@optimalai/optibot`) and the VS Code extension live in separate
  repositories.
- Vulnerabilities that require a malicious AI host already running locally
  with full access to the user's machine — that's outside this client's
  trust boundary.
