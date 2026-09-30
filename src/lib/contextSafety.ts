/**
 * Content check for the files a host asks this server to read and send with an
 * agent review (the `relatedPaths` input, usually filled from a review's
 * missing-context list). File names are screened in git.ts; this looks inside
 * the file, so a credential in an ordinarily named file is not sent either.
 * Mirrors the check in optibot-cli.
 */

// High-precision patterns only: each matches the fixed prefix or header a
// provider puts on a live credential, so ordinary code does not trip them.
const SECRET_CONTENT: ReadonlyArray<readonly [string, RegExp]> = [
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    // AKIA: long-lived keys; ASIA: temporary STS credentials.
    ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    // gh*_: classic tokens; github_pat_: fine-grained personal access tokens.
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{16,}\b/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
    ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
    ['Optibot API key', /\boptk_[A-Za-z0-9]{24,}\b/],
];

/** The kind of credential found in `content`, or null when none is found. */
export function findSecretInContent(content: string): string | null {
    for (const [kind, pattern] of SECRET_CONTENT) {
        if (pattern.test(content)) return kind;
    }
    return null;
}
