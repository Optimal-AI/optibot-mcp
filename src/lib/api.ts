import {
    AsyncReviewResponse,
    ReviewResultResponse,
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
            const msg = (errorData as { message?: unknown }).message;
            if (typeof msg === 'string') {
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

    /**
     * Request a review asynchronously. Returns a receipt ({ reviewId }) rather
     * than the review itself: the backend enqueues the work and the result is
     * fetched separately via {@link getReviewResult}. Requires a backend with
     * async review support deployed.
     */
    async review(params: {
        patch: string;
        repositoryName?: string;
        files?: Record<string, string>;
    }): Promise<AsyncReviewResponse> {
        const patchBase64 = Buffer.from(params.patch, 'utf-8').toString('base64');

        const body: Record<string, unknown> = { patch: patchBase64, async: true };

        if (params.repositoryName) {
            body.repositoryName = params.repositoryName;
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

        return await response.json() as AsyncReviewResponse;
    }

    /**
     * Fetch the result of an async review by its reviewId. Returns `pending`
     * while the review runs, `done` with the decoded payload when it finishes,
     * `failed` with an error, or `not_found` (HTTP 404) when the reviewId is
     * unknown or expired.
     */
    async getReviewResult(reviewId: string): Promise<ReviewResultResponse> {
        const response = await fetch(
            `${API_BASE_URL}/api/review/result/${encodeURIComponent(reviewId)}`,
            {
                method: 'GET',
                headers: {
                    ...CLIENT_HEADERS,
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            }
        );

        if (response.status === 404) {
            return { status: 'not_found' };
        }

        if (!response.ok) {
            await this.throwApiError(response);
        }

        const result = await response.json() as ReviewResultResponse;

        // Decode base64-encoded comments on a completed review.
        if (result.status === 'done') {
            if (typeof result.generalComment === 'string') {
                result.generalComment = Buffer.from(result.generalComment, 'base64').toString('utf-8');
            }
            if (Array.isArray(result.fileComments)) {
                result.fileComments = result.fileComments.map((comment) =>
                    typeof comment === 'string'
                        ? Buffer.from(comment, 'base64').toString('utf-8')
                        : comment
                );
            }
        }

        return result;
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
