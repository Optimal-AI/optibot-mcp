export interface CliConfig {
    apiKey: string;
}

export interface ReviewRequest {
    patch: string;
    repositoryName?: string;
    files?: Record<string, string>;
    reviewSessionId?: string;
}

export interface ReviewResponse {
    generalComment?: string;
    fileComments?: string[];
    reviewCount?: {
        current: number;
        limit: number;
        remaining: number;
        resetAt?: string;
    };
}

// ------ Agent review mode ------
// Mirrors the Optibot API contract for agent mode, which returns
// structured findings as native JSON (NOT base64-encoded, unlike full mode).

export type FindingSeverity = 'blocker' | 'warning' | 'nit';

export type FindingCategory =
    | 'bug'
    | 'security'
    | 'performance'
    | 'refactor'
    | 'tech-debt'
    | 'duplicate'
    | 'style'
    | 'documentation'
    | 'test'
    | 'other';

export interface AgentReviewFinding {
    /**
     * Identifies this finding within this response only. The server hashes the
     * reviewer's message into it and the reviewer runs at a non-zero
     * temperature, so two identical requests return different ids for the same
     * defect. Do not use it to match a finding across rounds or runs.
     */
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    /** false = valid finding whose lines fall outside the diff's changed ranges. */
    inPatch: boolean;
    severity: FindingSeverity;
    category: FindingCategory;
    /** Raw reviewer text — no wrapper, no jump link. */
    message: string;
    suggestedFix?: string;
    /** 1-10, surfaced from the reviewer. */
    confidence: number;
}

export interface AgentReviewCountInfo {
    current: number;
    limit: number;
    remaining: number;
    resetAt?: string;
}

export interface AgentReviewResponse {
    status: 'needs_changes' | 'looks_good';
    reviewPass: boolean;
    findings: AgentReviewFinding[];
    summary: string;
    /** File paths the reviewer needed but wasn't given — caller reads them locally and resubmits. */
    missingContext?: string[];
    /**
     * The three fields below are optional because every consumer already
     * treats them that way: the renderer guards each one, the tool's output
     * schema marks them optional, and an older or self-hosted backend may omit
     * them. A required type here only type-checks a caller that then crashes.
     */
    reviewCount?: AgentReviewCountInfo;
    isOptibotInstalled?: boolean;
    /**
     * `model`/`provider` name the model that produced the findings. The
     * service always sends both.
     */
    meta?: { mode: 'agent'; durationMs: number; model?: string; provider?: string };
}

/**
 * Outcome of submitting an agent review with `async: true`. A backend with the
 * async path answers 202 with a reviewId to poll ('accepted'); one without it
 * ignores the unknown field, runs the review inline, and answers 200 with the
 * finished review ('completed').
 */
export type AgentReviewSubmission =
    | { kind: 'completed'; review: AgentReviewResponse }
    | { kind: 'accepted'; reviewId: string; reviewCount?: AgentReviewCountInfo };

/**
 * Machine-readable failure kinds on the async result endpoint. The server names
 * the kinds it can distinguish and omits the field for everything else, so a
 * client branches on the ones it knows and treats an absent or unknown value as
 * a generic failure.
 */
export type AgentReviewErrorType = 'context_window_exceeded' | 'timeout';

/**
 * Response of GET /api/review/agent/result/:reviewId. Unlike the full-mode
 * result endpoint, a finished review is nested under `result` rather than
 * spread onto the envelope, because the review carries its own `status`.
 */
export type AgentReviewResultResponse =
    | { status: 'pending' }
    | { status: 'not_found' }
    | { status: 'failed'; error?: string; errorType?: AgentReviewErrorType | string }
    | { status: 'done'; result: AgentReviewResponse };

export interface AgentReviewRequest {
    patch: string;
    repositoryName?: string;
    /** Changed files: filePath -> raw (unencoded) content; the client base64-encodes them. */
    files?: Record<string, string>;
    /** Caller-gathered context beyond the diff (callers, imports, tests). */
    relatedFiles?: Record<string, string>;
    /** Plain-text (NOT base64) output of a local tsc/eslint/LSP run. */
    localDiagnostics?: string;
}

export interface ParsedFileComment {
    filePath: string;
    startLine: number;
    endLine: number;
    comment: string;
}

export interface GitChangedFile {
    relativePath: string;
    status: 'M' | 'A' | 'D' | 'R' | '?' | 'U';
}

export interface ApiKeyCreateResponse {
    id: number;
    name: string;
    keyPrefix: string;
    key: string;
    createdAt: string;
}

export interface ApiKeyListItem {
    id: number;
    name: string;
    keyPrefix: string;
    createdAt: string;
    lastUsedAt?: string;
}

export interface ApiKeyListResponse {
    keys: ApiKeyListItem[];
}

export interface ReviewStatus {
    current: number;
    limit: number;
    remaining: number;
    resetAt?: string;
}

// ------ Auth / organizations ------

export type OrganizationRole = 'owner' | 'member' | 'billing';

export interface Organization {
    id: number;
    name: string;
    displayName?: string | null;
    role?: OrganizationRole;
}

export interface OrgListResponse {
    organizations: Organization[];
    currentOrganizationId: number;
}

export interface RescopeResponse {
    token: string;
    expiresIn: number;
    organizationId: number;
}

export interface TokenResponseUser {
    firebaseUserId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
}

export interface TokenResponse {
    token: string;
    expiresIn: number;
    organizationId?: number;
    user: TokenResponseUser;
}

export interface OnboardingRequiredResponse {
    status: 'onboarding_required';
    onboardingUrl: string;
}

export type AuthResponse = TokenResponse | OnboardingRequiredResponse;

// ------ Security scan types ------

export type SecurityModelTier = 'low' | 'medium' | 'high';

export type SecuritySchedule = 'weekly' | 'monthly' | 'quarterly' | 'custom';

export interface SecurityScanSeverity {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
}

export interface SecurityScanResult {
    id: number;
    repositoryId: number;
    status: 'completed' | 'failed';
    issueCount: number;
    severity: SecurityScanSeverity | null;
    content: string | null;
    tokensUsed: number;
    costUSD: number;
    modelTier: SecurityModelTier | null;
    externalIssueUrl: string | null;
    scanDate: string;
    createdAt: string;
}

export interface SecurityScanListResponse {
    items: SecurityScanResult[];
    totalItems: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface SecurityConfig {
    enabled: boolean;
    schedule: SecuritySchedule;
    customCron: string | null;
    postAsIssue: boolean;
    modelTier: SecurityModelTier;
    maxBudgetUSD: number;
    selectedRepositoryIds: number[];
    lastScanDate: string | null;
}

export interface SecurityConfigResponse {
    config: SecurityConfig;
}

export interface SecurityConfigSaveRequest {
    enabled: boolean;
    schedule: SecuritySchedule;
    customCron?: string;
    postAsIssue: boolean;
    modelTier: SecurityModelTier;
    maxBudgetUSD: number;
    repositoryIds: number[];
}

export interface SecurityConfigSaveResponse {
    message: string;
    config: SecurityConfig;
}

export interface ScanPricingTier {
    inputCostPer1M: number;
    outputCostPer1M: number;
    cacheReadCostPer1M: number;
    cacheWriteCostPer1M: number;
}

export interface ScanPricingResponse {
    markupMultiplier: number;
    tiers: {
        low: ScanPricingTier;
        medium: ScanPricingTier;
        high: ScanPricingTier;
    };
}

export interface ScanUsageResponse {
    tokensUsed: number;
    costUSD: number;
    month: number;
    year: number;
}

export interface RepositoryStats {
    id: number;
    name: string;
    fullName?: string;
    [key: string]: unknown;
}

export interface ScanTriggerRequest {
    repositoryId: number;
    modelTier?: SecurityModelTier;
    maxBudgetUSD?: number;
    postAsIssue?: boolean;
}

export interface ScanTriggerResponse {
    message: string;
    sessionId: string | null;
}

// ------ Security scan progress (WebSocket) ------

export type SecurityScanProgressStep =
    | 'started'
    | 'cloning_repository'
    | 'scanning_code'
    | 'tool_call'
    | 'budget_update'
    | 'generating_report'
    | 'completed'
    | 'failed';

export interface SecurityScanProgressDetails {
    tool?: string;
    query?: string;
    tokensUsed?: number;
    costUSD?: number;
    repoName?: string;
    reason?: string;
}

export interface SecurityScanProgressEvent {
    step: SecurityScanProgressStep;
    message: string;
    details?: SecurityScanProgressDetails;
}
