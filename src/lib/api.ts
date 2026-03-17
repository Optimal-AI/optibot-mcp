import { ReviewResponse, ApiKeyCreateResponse, ApiKeyListItem, ApiKeyListResponse, UserProfile, ReviewStatus } from '../types.js';
import { getApiBaseUrl } from './apiConfig.js';

const API_BASE_URL = getApiBaseUrl();

export class ApiClient {
    constructor(private readonly apiKey: string) { }

    private async throwApiError(response: Response): Promise<never> {
        let errorMessage = `API request failed: ${response.statusText} (${response.status})`;
        let errorData: any = {};

        try {
            errorData = await response.json();
            if (errorData.message) {
                errorMessage = errorData.message;
            }
        } catch {
            // Use default error message
        }

        const error: any = new Error(errorMessage);
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

        const body: Record<string, any> = { patch: patchBase64 };

        if (params.repositoryName) {
            body.repositoryName = params.repositoryName;
        }

        if (params.reviewSessionId) {
            body.reviewSessionId = params.reviewSessionId;
        }

        if (params.files && Object.keys(params.files).length > 0) {
            const encodedFiles: Record<string, string> = {};
            for (const [filePath, content] of Object.entries(params.files)) {
                encodedFiles[filePath] = Buffer.from(content, 'utf-8').toString('base64');
            }
            body.files = encodedFiles;
        }

        const response = await fetch(`${API_BASE_URL}/api/review`, {
            method: 'POST',
            headers: {
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

    async createApiKey(name: string): Promise<ApiKeyCreateResponse> {
        const response = await fetch(`${API_BASE_URL}/api/keys`, {
            method: 'POST',
            headers: {
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
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }
    }

    async getUserProfile(): Promise<UserProfile> {
        const response = await fetch(`${API_BASE_URL}/api/user/profile`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as UserProfile;
    }

    async getReviewStatus(): Promise<ReviewStatus> {
        const response = await fetch(`${API_BASE_URL}/api/user/review-status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            await this.throwApiError(response);
        }

        return await response.json() as ReviewStatus;
    }
}
