const CI_ENV_KEYS = [
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'JENKINS_HOME',
    'BUILDKITE',
    'TRAVIS',
] as const;

/**
 * True if any common CI-runner env var is set. Used to refuse interactive
 * tools (browser login, guided setup) inside CI runners where they would
 * either hang on a missing browser or surprise the user with an unexpected
 * prompt.
 */
export function isCiEnvironment(): boolean {
    if (process.env.CI === 'true') return true;
    for (const key of CI_ENV_KEYS) {
        if (process.env[key]) return true;
    }
    return false;
}
