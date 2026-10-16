import * as path from 'path';
import type { ApiClient } from './api.js';
import * as git from './git.js';
import { sanitizeServerText } from './output.js';
import { safeSendLog, ToolExtraLike } from './notify.js';
import {
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

/**
 * The most repository-path bytes review_agent sends to the context scout,
 * counting one separator per path. It only binds on very large repositories,
 * where it keeps the request well under the service's request size limit.
 */
export const AGENT_SCOUT_MAX_PATH_LIST_BYTES = 4_000_000;

/**
 * Trims `paths` to `maxBytes` of UTF-8 (each path plus one separator), keeping
 * the paths that share the longest leading directory with a file in
 * `anchorPaths`. Paths with the same shared depth keep their original order.
 * Returns `paths` itself when it already fits.
 */
export function capRepositoryPaths(paths: string[], anchorPaths: string[], maxBytes: number): string[] {
    let total = 0;
    for (const p of paths) total += Buffer.byteLength(p) + 1;
    if (total <= maxBytes) return paths;

    // Every directory prefix of an anchor's directory, such as `a` and `a/b`
    // for `a/b/c.ts`, mapped to its depth.
    const anchorDirs = new Map<string, number>();
    for (const anchor of anchorPaths) {
        const parts = normalizeContextPath(anchor).split('/').slice(0, -1);
        for (let depth = 1; depth <= parts.length; depth++) {
            anchorDirs.set(parts.slice(0, depth).join('/'), depth);
        }
    }
    const sharedDepth = (p: string): number => {
        const parts = p.split('/');
        for (let depth = parts.length - 1; depth > 0; depth--) {
            if (anchorDirs.has(parts.slice(0, depth).join('/'))) return depth;
        }
        return 0;
    };

    const ranked = paths
        .map((p, index) => ({ p, index, depth: sharedDepth(p) }))
        .sort((a, b) => b.depth - a.depth || a.index - b.index);
    const kept: string[] = [];
    let used = 0;
    for (const { p } of ranked) {
        if (used + Buffer.byteLength(p) + 1 > maxBytes) continue;
        kept.push(p);
        used += Buffer.byteLength(p) + 1;
    }
    return kept;
}

/**
 * The reason reported when the service skipped the scout. A timeout and a
 * too-large change keep their own value; anything else reads as unavailable.
 */
function skipReasonFromService(reason: unknown): AgentScoutSkipReason {
    if (reason === 'timeout') return 'timeout';
    if (reason === 'input_too_large') return 'too_large';
    return 'unavailable';
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
        return none('unavailable');
    }
    if (repositoryPaths.length === 0) return none();

    const providedPaths = [...new Set(params.providedPaths.map(normalizeContextPath))];
    let answer;
    try {
        answer = await client.scoutAgentContext({
            patch: params.patch,
            providedPaths,
            repositoryPaths: capRepositoryPaths(repositoryPaths, providedPaths, AGENT_SCOUT_MAX_PATH_LIST_BYTES),
            repositoryName: params.repositoryName,
        });
    } catch (err) {
        // The review still runs: the scout must never fail one.
        // AbortSignal.timeout rejects with a DOMException named TimeoutError.
        return none((err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'unavailable');
    }
    if (typeof answer?.reviewTicket === 'string' && answer.reviewTicket !== '') reviewTicket = answer.reviewTicket;
    if (!answer || answer.skipped || !Array.isArray(answer.paths)) return none(skipReasonFromService(answer?.reason));

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
