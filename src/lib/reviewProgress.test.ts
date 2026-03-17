import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock socket.io-client before importing the module
const mockOn = vi.fn();
const mockEmit = vi.fn();
const mockDisconnect = vi.fn();

const mockSocket = {
    on: mockOn,
    emit: mockEmit,
    disconnect: mockDisconnect,
};

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

vi.mock('./apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

import { ReviewProgressService, ReviewProgressEvent } from './reviewProgress.js';
import { io } from 'socket.io-client';

describe('ReviewProgressService', () => {
    let service: ReviewProgressService;

    beforeEach(() => {
        vi.useFakeTimers();
        service = new ReviewProgressService();
        mockOn.mockReset();
        mockEmit.mockReset();
        mockDisconnect.mockReset();
        (io as any).mockClear();
    });

    afterEach(() => {
        service.endSession();
        vi.useRealTimers();
    });

    it('creates a socket connection on startSession', async () => {
        const callback = vi.fn();

        // Simulate connect event
        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'connect') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        const sessionId = await sessionPromise;

        expect(sessionId).toBeTruthy();
        expect(typeof sessionId).toBe('string');
        expect(io).toHaveBeenCalledWith('http://test-api.local', expect.objectContaining({
            transports: ['websocket'],
        }));
    });

    it('emits join-review-session on connect', async () => {
        const callback = vi.fn();

        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'connect') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        const sessionId = await sessionPromise;

        expect(mockEmit).toHaveBeenCalledWith('join-review-session', { reviewSessionId: sessionId });
    });

    it('invokes callback on review-progress events', async () => {
        const callback = vi.fn();
        let progressHandler: Function | null = null;

        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'review-progress') {
                progressHandler = handler;
            }
            if (event === 'connect') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        await sessionPromise;

        const event: ReviewProgressEvent = { step: 'analyzing_patch', message: 'Analyzing...' };
        progressHandler!(event);

        expect(callback).toHaveBeenCalledWith(event);
    });

    it('resolves with sessionId on connect_error', async () => {
        const callback = vi.fn();

        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'connect_error') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        const sessionId = await sessionPromise;

        expect(sessionId).toBeTruthy();
    });

    it('resolves with sessionId on timeout', async () => {
        const callback = vi.fn();

        // Don't trigger connect or connect_error — let timeout fire
        mockOn.mockImplementation(() => {});

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(5100);
        const sessionId = await sessionPromise;

        expect(sessionId).toBeTruthy();
    });

    it('endSession disconnects socket', async () => {
        const callback = vi.fn();

        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'connect_error') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        await sessionPromise;

        service.endSession();

        expect(mockDisconnect).toHaveBeenCalled();
    });

    it('endSession is safe to call multiple times', () => {
        service.endSession();
        service.endSession();
        // No error thrown
    });

    it('cleanup is called on startSession if previous session exists', async () => {
        const callback = vi.fn();

        mockOn.mockImplementation((event: string, handler: Function) => {
            if (event === 'connect_error') {
                setTimeout(() => handler(), 10);
            }
        });

        const sessionPromise1 = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        await sessionPromise1;

        // Start new session — should clean up the old one
        const sessionPromise2 = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(200);
        await sessionPromise2;

        expect(mockDisconnect).toHaveBeenCalled();
    });

    it('handles io() throwing an error gracefully', async () => {
        const callback = vi.fn();

        (io as any).mockImplementation(() => {
            throw new Error('Socket creation failed');
        });

        const sessionPromise = service.startSession(callback);
        await vi.advanceTimersByTimeAsync(100);
        const sessionId = await sessionPromise;

        // Should still resolve with a session ID (graceful degradation)
        expect(sessionId).toBeTruthy();
    });
});
