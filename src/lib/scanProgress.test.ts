import { describe, it, expect, vi, beforeEach } from 'vitest';

type Listener = (arg: unknown) => void;

interface FakeSocket {
    on: (event: string, listener: Listener) => void;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    _fire: (event: string, arg?: unknown) => void;
}

const sockets: FakeSocket[] = [];

function makeFakeSocket(): FakeSocket {
    const listeners = new Map<string, Listener[]>();
    const socket: FakeSocket = {
        on: (event, listener) => {
            const arr = listeners.get(event) ?? [];
            arr.push(listener);
            listeners.set(event, arr);
        },
        emit: vi.fn(),
        disconnect: vi.fn(),
        _fire: (event, arg) => {
            for (const l of listeners.get(event) ?? []) l(arg);
        },
    };
    sockets.push(socket);
    return socket;
}

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => makeFakeSocket()),
}));

vi.mock('./apiConfig.js', () => ({
    getApiBaseUrl: () => 'http://test-api.local',
}));

import { SecurityScanProgressService } from './scanProgress.js';

describe('SecurityScanProgressService', () => {
    beforeEach(() => {
        sockets.length = 0;
    });

    it('emits `join` with the session id once connected', async () => {
        const svc = new SecurityScanProgressService();
        const sessionPromise = svc.startSession(() => {});

        const socket = sockets[0];
        socket._fire('connect');

        const sessionId = await sessionPromise;
        expect(sessionId).toBeTruthy();
        expect(socket.emit).toHaveBeenCalledWith('join', sessionId);

        svc.endSession();
        expect(socket.disconnect).toHaveBeenCalled();
    });

    it('invokes the progress callback for each security-scan-progress event', async () => {
        const svc = new SecurityScanProgressService();
        const events: unknown[] = [];

        const sessionPromise = svc.startSession((e) => events.push(e));
        const socket = sockets[0];
        socket._fire('connect');
        await sessionPromise;

        socket._fire('security-scan-progress', { step: 'started', message: 'hi' });
        socket._fire('security-scan-progress', { step: 'completed', message: 'done' });

        expect(events).toEqual([
            { step: 'started', message: 'hi' },
            { step: 'completed', message: 'done' },
        ]);

        svc.endSession();
    });

    it('still resolves when the socket fails to connect', async () => {
        const svc = new SecurityScanProgressService();
        const sessionPromise = svc.startSession(() => {});

        const socket = sockets[0];
        socket._fire('connect_error');

        const sessionId = await sessionPromise;
        expect(typeof sessionId).toBe('string');

        svc.endSession();
    });

    it('endSession cleans up the socket and is safe to call twice', () => {
        const svc = new SecurityScanProgressService();
        svc.startSession(() => {}); // don't await
        const socket = sockets[0];

        svc.endSession();
        svc.endSession();

        expect(socket.disconnect).toHaveBeenCalled();
    });
});
