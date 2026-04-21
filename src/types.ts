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

export interface UserProfile {
    firebaseUserId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
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
