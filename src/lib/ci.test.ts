import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isCiEnvironment } from './ci';

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
