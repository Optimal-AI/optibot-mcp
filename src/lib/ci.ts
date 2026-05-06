const CI_ENV_KEYS = [
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'JENKINS_HOME',
    'BUILDKITE',
    'TRAVIS',
] as const;

export function isCiEnvironment(): boolean {
    if (process.env.CI === 'true') return true;
    for (const key of CI_ENV_KEYS) {
        if (process.env[key]) return true;
    }
    return false;
}

export interface SnippetOptions {
    apiKey?: string;
    packageName?: string;
}

const DEFAULT_PACKAGE = '@optimalai/optibot';
const KEY_PLACEHOLDER = 'optk_...';

export function renderGithubActionsYaml(opts: SnippetOptions = {}): string {
    const pkg = opts.packageName ?? DEFAULT_PACKAGE;
    return `name: Optibot Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run Optibot
        env:
          OPTIBOT_API_KEY: \${{ secrets.OPTIBOT_API_KEY }}
        run: npx -y ${pkg} review -b \${{ github.base_ref }}
`;
}

export function renderGitlabCiYaml(opts: SnippetOptions = {}): string {
    const pkg = opts.packageName ?? DEFAULT_PACKAGE;
    return `optibot-review:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    OPTIBOT_API_KEY: $OPTIBOT_API_KEY
  script:
    - git fetch origin $CI_MERGE_REQUEST_TARGET_BRANCH_NAME
    - npx -y ${pkg} review -b origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME
`;
}

export function renderGenericShell(opts: SnippetOptions = {}): string {
    const pkg = opts.packageName ?? DEFAULT_PACKAGE;
    const key = opts.apiKey ?? KEY_PLACEHOLDER;
    return `export OPTIBOT_API_KEY=${key}
npx -y ${pkg} review -b main
`;
}
