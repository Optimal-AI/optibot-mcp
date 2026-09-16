import {
    ReviewResponse,
    AgentReviewResponse,
    AgentReviewSubmission,
    AgentReviewResultResponse,
    ApiKeyCreateResponse,
    ApiKeyListItem,
    ApiKeyListResponse,
    ReviewStatus,
    OrgListResponse,
    RescopeResponse,
    ScanPricingResponse,
    ScanUsageResponse,
    SecurityScanListResponse,
    SecurityConfigResponse,
    SecurityConfigSaveRequest,
    SecurityConfigSaveResponse,
    ScanTriggerRequest,
    ScanTriggerResponse,
    RepositoryStats,
} from '../types.js';
import { getApiBaseUrl } from './apiConfig.js';
import { CLIENT_HEADERS } from './clientHeaders.js';

const API_BASE_URL = getApiBaseUrl();

export class ApiClient {
    constructor(private readonly apiKey: string) { }

    private async throwApiError(response: Response): Promise<never> {
        let errorMessage = `API request failed: ${response.statusText} (${response.status})`;
        let errorData: Record<string, unknown> = {};

        try {
            errorData = await response.json() as Record<string, unknown>;
            // The backend answers with `error` on every path the agent-mode
            // endpoints use, and with `message` on some older ones. Reading
            // only `message` dropped the actionable text — a 413 arrived as
            // "API request failed: Payload Too Large (413)" with the
            // explanation of what to do about it thrown away.
            const body = errorData as { message?: unknown; error?: unknown };
            const msg = typeof body.error === 'string' ? body.error : body.message;
            if (typeof msg === 'string' && msg.trim() !== '') {
                errorMessage = msg;
            }
        } catch {
            // Use default error message
        }

        const error = new Error(errorMessage) as Error & { status: number; data: Record<string, unknown> };
        error.status = response.status;
        error.data = errorData;
        throw error;
    }

    async review(params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
        reviewSessionId?: string;
    }): Promise<ReviewResponse> {
        const patchBase64 = Buffer.from(params.patch, 'utf-8').toString('base64');

        const body: Record<string, unknown> = { patch: patchBase64 };

        if (params.repositoryName) {
            body.repositoryName = params.repositoryName;
        }

        if (params.reviewSessionId) {
            body.reviewSessionId = params.reviewSessionId;
        }

        if (params.files && Object.keys(params.files).length > 0) {
            // Null-prototype map: filenames from a repo are untrusted input
            // (a file literally named `__proto__` would otherwise pollute).
            const encodedFiles: Record<string, string> = Object.create(null);
            for (const [filePath, content] of Object.entries(params.files)) {
                encodedFiles[filePath] = Buffer.from(content, 'utf-8').toString('base64');
            }
            body.files = encodedFiles;
        }

        const response = await fetch(`${API_BASE_URL}/api/review`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        const result = await response.json() as ReviewResponse;

        // Decode base64-encoded fields
        if (result.generalComment && typeof result.generalComment === 'string') {
            result.generalComment = Buffer.from(result.generalComment, 'base64').toString('utf-8');
        }

        if (result.fileComments && Array.isArray(result.fileComments)) {
            result.fileComments = result.fileComments.map((comment: string) => {
                if (typeof comment === 'string') {
                    return Buffer.from(comment, 'base64').toString('utf-8');
                }
                return comment;
            });
        }

        return result;
    }

    /**
     * Builds the agent-mode request body. `patch`, `files`, and `relatedFiles`
     * are base64-encoded; `localDiagnostics` is sent as plain text, per the
     * backend contract.
     */
    private buildAgentBody(params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
        relatedFiles?: Record<string, string>;
        localDiagnostics?: string;
    }): Record<string, unknown> {
        const patchBase64 = Buffer.from(params.patch, 'utf-8').toString('base64');

        const body: Record<string, unknown> = { patch: patchBase64 };

        if (params.repositoryName) {
            body.repositoryName = params.repositoryName;
        }

        // Base64-encode changed files and related-context files. Use
        // null-prototype maps: filenames from a repo are untrusted input
        // (a file literally named `__proto__` would otherwise pollute).
        if (params.files && Object.keys(params.files).length > 0) {
            const encodedFiles: Record<string, string> = Object.create(null);
            for (const [filePath, content] of Object.entries(params.files)) {
                encodedFiles[filePath] = Buffer.from(content, 'utf-8').toString('base64');
            }
            body.files = encodedFiles;
        }

        if (params.relatedFiles && Object.keys(params.relatedFiles).length > 0) {
            const encodedRelated: Record<string, string> = Object.create(null);
            for (const [filePath, content] of Object.entries(params.relatedFiles)) {
                encodedRelated[filePath] = Buffer.from(content, 'utf-8').toString('base64');
            }
            body.relatedFiles = encodedRelated;
        }

        // localDiagnostics is plain text (NOT base64), per the backend contract.
        if (params.localDiagnostics) {
            body.localDiagnostics = params.localDiagnostics;
        }

        return body;
    }

    /**
     * Runs an agent-mode review over a single synchronous request. Kept as the
     * fallback path: a review can run for minutes server-side, which is longer
     * than a proxy will hold a request open, so submitAgentReview is what the
     * tools use.
     */
    async reviewAgent(params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
        relatedFiles?: Record<string, string>;
        localDiagnostics?: string;
    }): Promise<AgentReviewResponse> {
        const response = await fetch(`${API_BASE_URL}/api/review/agent`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(this.buildAgentBody(params)),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        // Agent-mode response is native JSON — no base64 decode pass.
        return await response.json() as AgentReviewResponse;
    }

    /**
     * Submits an agent review with `async: true`. A backend with the async path
     * answers 202 with a reviewId to poll; one without it ignores the field and
     * answers 200 with the finished review, which is reported as 'completed' so
     * the caller needs no version check.
     */
    async submitAgentReview(params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
        relatedFiles?: Record<string, string>;
        localDiagnostics?: string;
    }): Promise<AgentReviewSubmission> {
        const body = this.buildAgentBody(params);
        body.async = true;

        const response = await fetch(`${API_BASE_URL}/api/review/agent`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        if (response.status === 202) {
            const accepted = await response.json() as {
                reviewId: string;
                reviewCount?: AgentReviewResponse['reviewCount'];
            };
            return { kind: 'accepted', reviewId: accepted.reviewId, reviewCount: accepted.reviewCount };
        }

        return { kind: 'completed', review: await response.json() as AgentReviewResponse };
    }

    /**
     * Fetches the result of an async agent review. A 404 maps to `not_found`
     * (unknown or expired reviewId) rather than throwing, because a poll issued
     * immediately after the submit can race the job becoming visible.
     */
    async getAgentReviewResult(reviewId: string): Promise<AgentReviewResultResponse> {
        const response = await fetch(
            `${API_BASE_URL}/api/review/agent/result/${encodeURIComponent(reviewId)}`,
            {
                method: 'GET',
                headers: {
                    ...CLIENT_HEADERS,
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            },
        );

        if (response.status === 404) {
            return { status: 'not_found' };
        }

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as AgentReviewResultResponse;
    }

    async createApiKey(name: string): Promise<ApiKeyCreateResponse> {
        const response = await fetch(`${API_BASE_URL}/api/keys`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ApiKeyCreateResponse;
    }

    async listApiKeys(): Promise<ApiKeyListItem[]> {
        const response = await fetch(`${API_BASE_URL}/api/keys`, {
            method: 'GET',
            headers: {
                ...CLIENT_HEADERS,
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        const result = await response.json() as ApiKeyListResponse;
        return result.keys;
    }

    async deleteApiKey(id: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/api/keys/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: {
                ...CLIENT_HEADERS,
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }
    }

    async getReviewStatus(): Promise<ReviewStatus> {
        const response = await fetch(`${API_BASE_URL}/api/user/review-status`, {
            method: 'GET',
            headers: {
                ...CLIENT_HEADERS,
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ReviewStatus;
    }

    async listOrganizations(): Promise<OrgListResponse> {
        const response = await fetch(`${API_BASE_URL}/client/organizations`, {
            method: 'GET',
            headers: {
                ...CLIENT_HEADERS,
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as OrgListResponse;
    }

    async rescopeToken(organizationId: number): Promise<RescopeResponse> {
        const response = await fetch(`${API_BASE_URL}/client/token/rescope`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ organizationId }),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as RescopeResponse;
    }

    async getSecurityPricing(): Promise<ScanPricingResponse> {
        const response = await fetch(`${API_BASE_URL}/api/security/pricing`, {
            method: 'GET',
            headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ScanPricingResponse;
    }

    async getSecurityUsage(): Promise<ScanUsageResponse> {
        const response = await fetch(`${API_BASE_URL}/api/security/usage`, {
            method: 'GET',
            headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ScanUsageResponse;
    }

    async listSecurityIssues(params: {
        page?: number;
        pageSize?: number;
        repositoryIds?: number[];
    } = {}): Promise<SecurityScanListResponse> {
        const query = new URLSearchParams();
        if (params.page !== undefined) query.set('page', String(params.page));
        if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
        if (params.repositoryIds && params.repositoryIds.length > 0) {
            query.set('repositoryIds', params.repositoryIds.join(','));
        }
        const qs = query.toString();
        const url = `${API_BASE_URL}/api/security/issues${qs ? `?${qs}` : ''}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.apiKey}` },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as SecurityScanListResponse;
    }

    async triggerSecurityScan(
        body: ScanTriggerRequest,
        sessionId?: string,
    ): Promise<ScanTriggerResponse> {
        const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const response = await fetch(`${API_BASE_URL}/api/security/scan${qs}`, {
            method: 'POST',
            headers: {
                ...CLIENT_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ScanTriggerResponse;
    }

    async getSecurityConfig(organizationId: number): Promise<SecurityConfigResponse> {
        const response = await fetch(
            `${API_BASE_URL}/api/organizations/${organizationId}/security-configs`,
            {
                method: 'GET',
                headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.apiKey}` },
            }
        );

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as SecurityConfigResponse;
    }

    async saveSecurityConfig(
        organizationId: number,
        body: SecurityConfigSaveRequest,
    ): Promise<SecurityConfigSaveResponse> {
        const response = await fetch(
            `${API_BASE_URL}/api/organizations/${organizationId}/security-configs`,
            {
                method: 'PUT',
                headers: {
                    ...CLIENT_HEADERS,
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as SecurityConfigSaveResponse;
    }

    async listRepositoryStats(organizationId: number): Promise<RepositoryStats[]> {
        const response = await fetch(
            `${API_BASE_URL}/api/organizations/${organizationId}/repositories/stats`,
            {
                method: 'GET',
                headers: { ...CLIENT_HEADERS, 'Authorization': `Bearer ${this.apiKey}` },
            }
        );

        if (!response.ok) {
            await this.throwApiError(response);
        }

        const json = await response.json();
        // Backend may return an array or { items: [...] } — normalize to an array.
        if (Array.isArray(json)) {
            return json as RepositoryStats[];
        }
        if (json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items)) {
            return (json as { items: RepositoryStats[] }).items;
        }
        return [];
    }
}
