import { describe, it, expect } from 'vitest';

import { findSecretInContent } from './contextSafety.js';

describe('findSecretInContent', () => {
    it.each([
        ['private key', 'x\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n'],
        ['private key', '{"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIE"}'],
        ['AWS access key', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE'],
        ['AWS access key', 'aws_access_key_id = ASIAIOSFODNN7EXAMPLE'],
        ['GitHub token', `token: ghp_${'a'.repeat(36)}`],
        ['GitHub token', `token: github_pat_11ABCDEFG0${'a'.repeat(40)}`],
        ['Slack token', 'SLACK=xoxb-123456789012-abcdefghij'],
        ['Stripe live key', `STRIPE=sk_live_${'a'.repeat(24)}`],
        ['Google API key', `key=AIza${'b'.repeat(35)}`],
        ['Anthropic API key', `ANTHROPIC_API_KEY=sk-ant-${'c'.repeat(40)}`],
        ['OpenAI API key', `OPENAI_API_KEY=sk-proj-${'d'.repeat(40)}`],
        ['Optibot API key', `OPTIBOT_API_KEY=optk_${'e'.repeat(32)}`],
    ])('finds a %s', (kind, content) => {
        expect(findSecretInContent(content)).toBe(kind);
    });

    it.each([
        'export const add = (a: number, b: number) => a + b;',
        'const key = process.env.STRIPE_SECRET_KEY;',
        '# Set OPTIBOT_API_KEY=optk_... in CI',
        'const test = "sk_test_placeholder";',
        '',
    ])('finds nothing in ordinary code: %s', (content) => {
        expect(findSecretInContent(content)).toBeNull();
    });
});
