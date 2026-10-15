import * as path from 'path';
import type { ApiClient } from './api.js';
import * as git from './git.js';
import { sanitizeServerText } from './output.js';
import { safeSendLog, ToolExtraLike } from './notify.js';
import {
    AGENT_SCOUT_BACKEND_SKIP_REASONS,
    AgentScoutedFile,
    AgentScoutMeta,
    AgentScoutSkipReason,
} from '../types.js';

/**
 * The smallest change, in added plus removed lines, for which review_agent
 * calls the context scout. A small change rarely needs a second round, so the
 * scout's own call would cost more time than it saves. The Optibot CLI uses
 * the same threshold.
 */
export const AGENT_SCOUT_MIN_CHANGED_LINES = 200;

/**
 * Counts the added and removed lines of a unified diff. Only lines inside a
 * hunk count, so the `---` and `+++` file headers do not, while a removed line
 * whose text starts with dashes (shown as `--- ...`) does.
 */
export function countChangedLines(patch: string): number {
    let inHunk = false;
    let changed = 0;
    for (const line of patch.split('\n')) {
        if (line.startsWith('@@')) {
            inHunk = true;
        } else if (line.startsWith('diff --git')) {
            inHunk = false;
        } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
            changed++;
        }
    }
    return changed;
}

/** The comparison form of a repository-relative path, so `./a.ts`, `a\\b.ts`, and `a/b.ts` compare equal. */
export function normalizeContextPath(p: string): string {
    return path.posix.normalize(p.replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
}

/** The backend's skip reason when it is one this client knows, so unexpected server text never reaches the output. */
function backendSkipReason(reason: unknown): AgentScoutSkipReason | undefined {
    return (AGENT_SCOUT_BACKEND_SKIP_REASONS as readonly unknown[]).includes(reason)
        ? (reason as AgentScoutSkipReason)
        : undefined;
}

/** What the scout step produced for the review that follows it. */
export interface ScoutOutcome {
    /** The scouted files to send, in rank order. */
    files: AgentScoutedFile[];
    /** Present whenever the scout answered with a ticket, including when it picked nothing. */
    reviewTicket?: string;
    meta: AgentScoutMeta;
    /** One line for each scouted path that was not read, and why. */
    warnings: string[];
}

export interface ScoutParams {
    patch: string;
    repositoryName?: string;
    /** Repository-relative paths the review already sends: the changed files and the related files. */
    providedPaths: string[];
}

/**
 * The context scout: asks the backend which repository files the review will
 * need, then reads them so they go with the first review request. Below
 * AGENT_SCOUT_MIN_CHANGED_LINES it does not call the backend at all.
 *
 * The scout never fails a review. No repository file list, an older backend's
 * 404, a timeout, a network or quota error, and a skipped answer all yield no
 * files, and the review runs as it would without the scout.
 */
export async function runScout(
    client: Pick<ApiClient, 'scoutAgentContext'>,
    params: ScoutParams,
    repoRoot: string,
    budget: git.UploadBudget,
    extra?: ToolExtraLike,
): Promise<ScoutOutcome> {
    if (countChangedLines(params.patch) < AGENT_SCOUT_MIN_CHANGED_LINES) {
        return { files: [], meta: { durationMs: 0, files: [], skipped: true, reason: 'small_change' }, warnings: [] };
    }

    const startedAt = Date.now();
    let reviewTicket: string | undefined;
    const none = (reason?: AgentScoutSkipReason): ScoutOutcome => ({
        files: [],
        ...(reviewTicket ? { reviewTicket } : {}),
        meta: { durationMs: Date.now() - startedAt, files: [], skipped: true, ...(reason ? { reason } : {}) },
        warnings: [],
    });

    let repositoryPaths: string[];
    try {
        repositoryPaths = await git.getTrackedFiles(repoRoot);
    } catch {
        return none();
    }
    if (repositoryPaths.length === 0) return none();

    const providedPaths = [...new Set(params.providedPaths.map(normalizeContextPath))];
    let answer;
    try {
        answer = await client.scoutAgentContext({
            patch: params.patch,
            providedPaths,
            repositoryPaths,
            repositoryName: params.repositoryName,
        });
    } catch (err) {
        // The review still runs: the scout must never fail one.
        // AbortSignal.timeout rejects with a DOMException named TimeoutError.
        return none((err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : undefined);
    }
    if (typeof answer?.reviewTicket === 'string' && answer.reviewTicket !== '') reviewTicket = answer.reviewTicket;
    if (!answer || answer.skipped || !Array.isArray(answer.paths)) return none(backendSkipReason(answer?.reason));

    // Only paths this client sent as tracked, and none it already sends. That
    // also keeps arbitrary server text out of the notice below.
    const tracked = new Set(repositoryPaths.map(normalizeContextPath));
    const supplied = new Set(providedPaths);
    const wanted: string[] = [];
    for (const entry of [...answer.paths]
        // A rank that is not a number would make the order undefined, and the
        // backend drops scouted files from the end when they do not fit.
        .filter((p) => typeof p?.path === 'string' && Number.isFinite(p.rank))
        .sort((a, b) => a.rank - b.rank)) {
        const key = normalizeContextPath(entry.path);
        if (tracked.has(key) && !supplied.has(key) && !wanted.includes(key)) wanted.push(key);
    }

    // The scout ran and picked nothing new: not skipped, so a reader can tell
    // it from a scout that did not run.
    if (wanted.length === 0) {
        return {
            files: [],
            ...(reviewTicket ? { reviewTicket } : {}),
            meta: { durationMs: Date.now() - startedAt, files: [], skipped: false },
            warnings: [],
        };
    }

    // Say which files are read before reading them.
    safeSendLog(
        extra,
        'optibot',
        `Optibot's context step picked ${wanted.length} file(s) from your working copy: ${wanted.map(sanitizeServerText).join(', ')}`,
    );

    const files: AgentScoutedFile[] = [];
    const warnings: string[] = [];
    for (const requested of wanted) {
        const read = await git.readScoutedFile(requested, repoRoot, budget);
        if (read.ok) {
            files.push({ path: requested, content: read.content });
        } else {
            warnings.push(read.warning);
        }
    }
    return {
        files,
        ...(reviewTicket ? { reviewTicket } : {}),
        meta: { durationMs: Date.now() - startedAt, files: files.map((f) => f.path), skipped: false },
        warnings,
    };
}
