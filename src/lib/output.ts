import {
    ReviewResponse,
    ParsedFileComment,
    AgentReviewResponse,
    AgentReviewFinding,
    FindingSeverity,
} from '../types.js';

const FILE_COMMENT_REGEX = /---start-file-comment---(.+?)-\/-(\d+)-\/-(\d+)---\n([\s\S]*?)(?:\n---end-file-comment---|$)/g;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function sanitizeServerText(text: string): string {
    return text.replace(CONTROL_CHARS_REGEX, '');
}

export function formatResetTime(resetAt: string): string {
    try {
        const resetDate = new Date(resetAt);
        if (isNaN(resetDate.getTime())) return resetAt;
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();

        if (diffMs <= 0) return 'soon';

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `in ${days}d`;
        }
        if (hours > 0) return `in ${hours}h ${minutes}m`;
        return `in ${minutes}m`;
    } catch {
        return resetAt;
    }
}

export function parseFileComments(fileComments: string[]): ParsedFileComment[] {
    const parsed: ParsedFileComment[] = [];

    for (const raw of fileComments) {
        FILE_COMMENT_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = FILE_COMMENT_REGEX.exec(raw)) !== null) {
            parsed.push({
                filePath: match[1],
                startLine: parseInt(match[2], 10),
                endLine: parseInt(match[3], 10),
                comment: match[4].trim(),
            });
        }
    }

    return parsed;
}

/**
 * True when the service reported a real daily ceiling.
 *
 * With no daily limit configured — the default for agent reviews, and the
 * current state of production — the backend answers with
 * Number.MAX_SAFE_INTEGER for `limit` and `remaining` and 0 for `current`,
 * because it short-circuits before counting anything. Rendering that verbatim
 * produces "Reviews used: 0/9007199254740991", so the counter is omitted
 * instead: there is no quota to report.
 */
export function hasReviewQuota(
    rc: { current?: number; limit?: number; remaining?: number } | undefined,
): rc is { current: number; limit: number; remaining: number; resetAt?: string } {
    if (!rc) return false;
    // `remaining` is checked as well as narrowed: the footer interpolates all
    // three, so a response carrying current and limit but no remaining would
    // otherwise render "(undefined remaining)".
    if (typeof rc.current !== 'number' || typeof rc.limit !== 'number' || typeof rc.remaining !== 'number') return false;
    if (!Number.isFinite(rc.limit) || !Number.isFinite(rc.current) || !Number.isFinite(rc.remaining)) return false;
    return rc.limit < Number.MAX_SAFE_INTEGER;
}

export function formatReview(response: ReviewResponse): string {
    const lines: string[] = [];

    if (response.generalComment) {
        lines.push('## Review Summary', '', sanitizeServerText(response.generalComment), '');
    }

    if (response.fileComments && response.fileComments.length > 0) {
        const comments = parseFileComments(response.fileComments);

        if (comments.length > 0) {
            lines.push('## File Comments', '');

            for (const c of comments) {
                lines.push(`### ${sanitizeServerText(c.filePath)} (lines ${c.startLine}-${c.endLine})`, '');
                lines.push(sanitizeServerText(c.comment), '');
            }
        }
    }

    if (hasReviewQuota(response.reviewCount)) {
        const rc = response.reviewCount;
        let line = `Reviews used: ${rc.current}/${rc.limit} (${rc.remaining} remaining)`;
        if (rc.resetAt) {
            line += ` · Resets ${formatResetTime(rc.resetAt)}`;
        }
        lines.push(`---`, line);
    }

    return lines.join('\n');
}

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
    blocker: 'Blocker',
    warning: 'Warning',
    nit: 'Nit',
};

const SEVERITY_ORDER: FindingSeverity[] = ['blocker', 'warning', 'nit'];

/**
 * Render a lightweight text bar (filled/empty blocks) for the given fraction of
 * a total. Used for the structural severity breakdown the host reads at a glance.
 */
function severityBar(count: number, total: number, width = 18): string {
    if (total <= 0) return '░'.repeat(width);
    const filled = Math.round((count / total) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

function formatLineRange(startLine: number, endLine: number): string {
    return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function formatFinding(finding: AgentReviewFinding, index: number): string[] {
    const lines: string[] = [];
    const sev = SEVERITY_LABEL[finding.severity] ?? finding.severity;
    const loc = `${sanitizeServerText(finding.file)}:${formatLineRange(finding.startLine, finding.endLine)}`;
    const patchNote = finding.inPatch ? '' : ' _(outside the changed lines)_';

    lines.push(`### ${index}. [${sev} · ${sanitizeServerText(finding.category)}] ${loc}${patchNote}`);
    lines.push('');
    lines.push(`- **id:** \`${sanitizeServerText(finding.id)}\``);
    lines.push(`- **confidence:** ${finding.confidence}/10`);
    lines.push('');
    lines.push(sanitizeServerText(finding.message));

    if (finding.suggestedFix && finding.suggestedFix.trim()) {
        lines.push('');
        // A suggested fix is model output derived from the reviewed code,
        // which the service treats as untrusted — it may include code someone
        // else wrote. The service says plainly that it cannot enforce this
        // rule, and the consumer here is an agent that can edit files without
        // being asked, so the obligation is stated next to every fix.
        lines.push('**Suggested fix** — show it to the user and get their agreement before applying it:');
        lines.push('');
        lines.push('```');
        lines.push(sanitizeServerText(finding.suggestedFix));
        lines.push('```');
    }

    lines.push('');
    return lines;
}

/**
 * Render an agent-mode review as readable markdown for a coding-agent host.
 *
 * This renders a structural severity breakdown for an at-a-glance read, then
 * every finding. It does not ask the host to classify the findings as signal or
 * noise: the production skill dropped that self-report, and the two hosts say
 * the same thing about the same review.
 */
export function formatAgentReview(response: AgentReviewResponse): string {
    const lines: string[] = [];
    const findings = Array.isArray(response.findings) ? response.findings : [];
    const total = findings.length;

    const statusLabel = response.status === 'looks_good' ? 'Looks good ✅' : 'Needs changes';
    lines.push(`## Optibot agent review — ${statusLabel}`);
    lines.push('');
    lines.push(`Pass: ${response.reviewPass ? 'yes' : 'no'} · Findings: ${total}`);
    if (response.meta) {
        const parts: string[] = [`mode: ${response.meta.mode}`, `${(response.meta.durationMs / 1000).toFixed(1)}s`];
        if (response.meta.model) parts.push(`model: ${sanitizeServerText(response.meta.model)}`);
        if (response.meta.provider) parts.push(`provider: ${sanitizeServerText(response.meta.provider)}`);
        lines.push(`_(${parts.join(' · ')})_`);
    }
    lines.push('');

    if (response.summary && response.summary.trim()) {
        lines.push('### Summary');
        lines.push('');
        lines.push(sanitizeServerText(response.summary));
        lines.push('');
    }

    // Structural severity breakdown — a bar the host can read directly.
    const counts: Record<FindingSeverity, number> = { blocker: 0, warning: 0, nit: 0 };
    for (const f of findings) {
        if (f.severity in counts) counts[f.severity] += 1;
    }
    lines.push('### Severity breakdown');
    lines.push('');
    lines.push('```');
    for (const sev of SEVERITY_ORDER) {
        const c = counts[sev];
        const pct = total > 0 ? Math.round((c / total) * 100) : 0;
        const label = SEVERITY_LABEL[sev].padEnd(8);
        lines.push(`${label} ${severityBar(c, total)}  ${String(pct).padStart(3)}%   ${c}/${total}`);
    }
    lines.push('```');
    lines.push('');

    if (total === 0) {
        lines.push('No findings.');
    } else {
        lines.push('### Findings');
        lines.push('');
        findings.forEach((finding, i) => {
            lines.push(...formatFinding(finding, i + 1));
        });

    }

    if (response.missingContext && response.missingContext.length > 0) {
        const missing = response.missingContext.map(f => sanitizeServerText(f));
        lines.push('');
        lines.push('### Missing context — re-run for a sharper review');
        lines.push('');
        lines.push('The reviewer needed these files but was not given them:');
        lines.push('');
        for (const file of missing) {
            lines.push(`- \`${file}\``);
        }
        lines.push('');
        // Host-driven resubmit: the tool is a thin single-shot primitive and
        // does NOT loop on its own. The host re-calls `review_agent`, passing
        // the missing files back through the `relatedPaths` input.
        const pathsLiteral = missing.map(f => JSON.stringify(f)).join(', ');
        lines.push(`To let the reviewer see these, call \`review_agent\` again with \`relatedPaths: [${pathsLiteral}]\`. Each re-run spends one review from your quota.`);
    }

    if (hasReviewQuota(response.reviewCount)) {
        const rc = response.reviewCount;
        let line = `Reviews used: ${rc.current}/${rc.limit} (${rc.remaining} remaining)`;
        if (rc.resetAt) {
            line += ` · Resets ${formatResetTime(rc.resetAt)}`;
        }
        lines.push('');
        lines.push('---');
        lines.push(line);
    }

    return lines.join('\n');
}

export function formatError(error: unknown): string {
    const err = error as any;
    const status = err?.status;

    const code = (err?.data as { code?: string } | undefined)?.code;
    if (code === 'TRIAL_REVIEW_LIMIT_REACHED') {
        const limit = (err?.data as { limit?: number }).limit;
        const used = (err?.data as { used?: number }).used;
        const hasUsed = typeof used === 'number' && Number.isFinite(used) && used >= 0;
        const upgradeUrl = sanitizeServerText((err?.data as { upgradeUrl?: string }).upgradeUrl || 'https://agents.getoptimal.ai/dashboard/billing');
        const detail = Number.isFinite(limit)
            ? hasUsed
                ? `Your organization has used ${used} of ${limit} code reviews included in your trial.`
                : `Your organization has used all ${limit} code reviews included in your trial.`
            : 'Your organization has reached its trial review limit.';
        return `Trial review limit reached. ${detail} Upgrade to keep reviewing: ${upgradeUrl}`;
    }
    if (code === 'MAX_REVIEW_LIMIT_REACHED') {
        const limit = (err?.data as { limit?: number }).limit;
        const used = (err?.data as { used?: number }).used;
        const hasUsed = typeof used === 'number' && Number.isFinite(used) && used >= 0;
        const contactUrl = sanitizeServerText((err?.data as { contactUrl?: string }).contactUrl || 'https://getoptimal.ai/contact');
        const detail = Number.isFinite(limit)
            ? hasUsed
                ? `Your organization has used ${used} of ${limit} code reviews.`
                : `Your organization has reached its limit of ${limit} code reviews.`
            : 'Your organization has reached its review limit.';
        return `Review limit reached. ${detail} Contact us to raise it: ${contactUrl}`;
    }

    if (status === 401) {
        return 'Authentication failed. Check that your API key is valid and starts with "optk_". Set OPTIBOT_API_KEY environment variable or use the login tool.';
    } else if (status === 429) {
        const reviewCount = err?.data?.reviewCount;
        const resetAt = err?.data?.resetAt;
        let msg = 'Review Limit Reached. ';

        if (reviewCount) {
            msg += `You have used ${reviewCount.current} of ${reviewCount.limit} reviews today. `;
        } else {
            msg += 'You have reached your review limit for today. ';
        }

        if (resetAt) {
            const resetDate = new Date(resetAt);
            if (!isNaN(resetDate.getTime())) {
                const time = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                const date = resetDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
                msg += `Your limit will reset at ${time} on ${date}. `;
            }
        }

        msg += 'If you need more reviews, contact us: https://getoptimal.ai/contact';
        return msg;
    } else if (status === 403) {
        // Strip ANSI / control chars from server-supplied text — error
        // messages flow into MCP tool results that the host LLM ingests.
        const serverError = typeof err?.data?.error === 'string' ? sanitizeServerText(err.data.error) : '';
        return serverError || 'No seat assigned. Ask your organization owner to assign you a seat.';
    } else if (status === 402) {
        return 'Your plan does not include code reviews. Please upgrade.';
    }

    const safeMessage = typeof err?.message === 'string' ? sanitizeServerText(err.message) : '';
    return `Error: ${safeMessage || 'Unknown error'}`;
}
