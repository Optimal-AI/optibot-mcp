import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    isCiEnvironment,
    renderGithubActionsYaml,
    renderGitlabCiYaml,
    renderGenericShell,
} from './ci';

const SNAPSHOT_KEYS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_HOME', 'BUILDKITE', 'TRAVIS'] as const;

describe('isCiEnvironment', () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of SNAPSHOT_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of SNAPSHOT_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it('returns false when no CI markers are set', () => {
        expect(isCiEnvironment()).toBe(false);
    });

    it('returns true when CI=true', () => {
        process.env.CI = 'true';
        expect(isCiEnvironment()).toBe(true);
    });

    it('ignores CI=false', () => {
        process.env.CI = 'false';
        expect(isCiEnvironment()).toBe(false);
    });

    it.each([
        'GITHUB_ACTIONS',
        'GITLAB_CI',
        'CIRCLECI',
        'JENKINS_HOME',
        'BUILDKITE',
        'TRAVIS',
    ])('returns true when %s is set to any non-empty value', (key) => {
        process.env[key] = '1';
        expect(isCiEnvironment()).toBe(true);
    });
});

describe('renderGithubActionsYaml', () => {
    it('emits a workflow with placeholder when no key is provided', () => {
        const yaml = renderGithubActionsYaml();
        expect(yaml).toContain('name: Optibot Review');
        expect(yaml).toContain('OPTIBOT_API_KEY: ${{ secrets.OPTIBOT_API_KEY }}');
        expect(yaml).toContain('npx -y @optimalai/optibot review -b ${{ github.base_ref }}');
        expect(yaml).toContain('actions/checkout@v4');
        expect(yaml).toContain('node-version: 20');
    });

    it('does not inline the api key into the workflow body', () => {
        const yaml = renderGithubActionsYaml({ apiKey: 'optk_secret' });
        expect(yaml).not.toContain('optk_secret');
        expect(yaml).toContain('OPTIBOT_API_KEY: ${{ secrets.OPTIBOT_API_KEY }}');
    });

    it('uses overridden package name', () => {
        const yaml = renderGithubActionsYaml({ packageName: '@scope/custom' });
        expect(yaml).toContain('npx -y @scope/custom');
    });
});

describe('renderGitlabCiYaml', () => {
    it('emits a merge-request job that targets the MR target branch', () => {
        const yaml = renderGitlabCiYaml();
        expect(yaml).toContain('optibot-review:');
        expect(yaml).toContain('image: node:20');
        expect(yaml).toContain('$CI_PIPELINE_SOURCE == "merge_request_event"');
        expect(yaml).toContain('OPTIBOT_API_KEY: $OPTIBOT_API_KEY');
        expect(yaml).toContain('git fetch origin $CI_MERGE_REQUEST_TARGET_BRANCH_NAME');
        expect(yaml).toContain('-b origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME');
    });

    it('does not inline the api key', () => {
        const yaml = renderGitlabCiYaml({ apiKey: 'optk_secret' });
        expect(yaml).not.toContain('optk_secret');
    });
});

describe('renderGenericShell', () => {
    it('uses placeholder when no key is provided', () => {
        const sh = renderGenericShell();
        expect(sh).toContain('export OPTIBOT_API_KEY=optk_...');
        expect(sh).toContain('npx -y @optimalai/optibot review -b main');
    });

    it('inlines the actual key when provided', () => {
        const sh = renderGenericShell({ apiKey: 'optk_real' });
        expect(sh).toContain('export OPTIBOT_API_KEY=optk_real');
    });
});
