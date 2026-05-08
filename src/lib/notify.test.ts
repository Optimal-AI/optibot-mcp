import { describe, it, expect, vi } from 'vitest';
import { safeSendLog } from './notify.js';

describe('safeSendLog', () => {
    it('forwards a notification when sendNotification exists', () => {
        const send = vi.fn();
        safeSendLog({ sendNotification: send }, 'optibot', 'hello');
        expect(send).toHaveBeenCalledWith({
            method: 'notifications/message',
            params: { level: 'info', logger: 'optibot', data: 'hello' },
        });
    });

    it('is a no-op when extra is undefined', () => {
        expect(() => safeSendLog(undefined, 'optibot', 'hi')).not.toThrow();
    });

    it('is a no-op when extra has no sendNotification', () => {
        expect(() => safeSendLog({}, 'optibot', 'hi')).not.toThrow();
    });

    it('swallows synchronous throws', () => {
        const send = vi.fn(() => { throw new Error('Server does not support logging'); });
        expect(() => safeSendLog({ sendNotification: send }, 'optibot', 'x')).not.toThrow();
        expect(send).toHaveBeenCalled();
    });

    it('swallows async rejections', async () => {
        const send = vi.fn(() => Promise.reject(new Error('async fail')));
        expect(() => safeSendLog({ sendNotification: send }, 'optibot', 'x')).not.toThrow();
        // Give the rejected promise a tick to settle — should not surface
        // as an unhandled rejection.
        await new Promise(r => setTimeout(r, 1));
    });
});
