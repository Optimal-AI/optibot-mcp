import { io, Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { getApiBaseUrl } from './apiConfig.js';
import { SecurityScanProgressEvent } from '../types.js';

export type ScanProgressCallback = (event: SecurityScanProgressEvent) => void;

/**
 * Subscribes to the backend's `security-scan-progress` WebSocket channel.
 * Mirrors ReviewProgressService but uses the scan-specific event name and
 * the generic `join` room-subscribe event exposed by optibot-be's socket.
 *
 * Fire-and-forget: if the socket fails to connect within the timeout the
 * session still resolves (the caller continues with the HTTP scan and just
 * forfeits live progress — the final row is still picked up via polling).
 */
export class SecurityScanProgressService {
    private socket: Socket | null = null;
    private sessionId: string | null = null;
    private callback: ScanProgressCallback | null = null;
    private connectionTimeout: NodeJS.Timeout | null = null;

    async startSession(onProgress: ScanProgressCallback): Promise<string> {
        this.cleanup();

        this.sessionId = randomUUID();
        this.callback = onProgress;

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
                    // BE's generic room-join channel (src/utils/socket.ts in optibot-be).
                    this.socket!.emit('join', this.sessionId);
                    setTimeout(() => resolve(this.sessionId!), 100);
                });

                this.socket.on('security-scan-progress', (event: SecurityScanProgressEvent) => {
                    if (this.callback) this.callback(event);
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
        this.callback = null;
    }
}
