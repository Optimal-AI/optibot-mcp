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
