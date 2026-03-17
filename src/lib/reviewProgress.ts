import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { getApiBaseUrl } from './apiConfig.js';

export type ReviewProgressStep =
    | 'started'
    | 'analyzing_patch'
    | 'tool_call'
    | 'generating_review'
    | 'completed';

export interface ReviewProgressEvent {
    step: ReviewProgressStep;
    message: string;
    details?: {
        tool?: string;
        query?: string;
        fileCount?: number;
    };
}

export type ProgressCallback = (event: ReviewProgressEvent) => void;

export class ReviewProgressService {
    private socket: Socket | null = null;
    private sessionId: string | null = null;
    private progressCallback: ProgressCallback | null = null;
    private connectionTimeout: NodeJS.Timeout | null = null;

    async startSession(onProgress: ProgressCallback): Promise<string> {
        this.cleanup();

        this.sessionId = randomUUID();
        this.progressCallback = onProgress;

        return new Promise((resolve) => {
            try {
                this.socket = io(getApiBaseUrl(), {
                    transports: ['websocket'],
                    reconnectionAttempts: 2,
                    timeout: 5000,
                });

                this.connectionTimeout = setTimeout(() => {
                    resolve(this.sessionId!);
                }, 5000);

                this.socket.on('connect', () => {
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }

                    this.socket!.emit('join-review-session', { reviewSessionId: this.sessionId });

                    setTimeout(() => resolve(this.sessionId!), 100);
                });

                this.socket.on('review-progress', (event: ReviewProgressEvent) => {
                    if (this.progressCallback) {
                        this.progressCallback(event);
                    }
                });

                this.socket.on('connect_error', () => {
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    resolve(this.sessionId!);
                });

            } catch {
                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }
                resolve(this.sessionId!);
            }
        });
    }

    endSession(): void {
        this.cleanup();
    }

    private cleanup(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.sessionId = null;
        this.progressCallback = null;
    }
}
