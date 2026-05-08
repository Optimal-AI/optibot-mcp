/**
 * Best-effort wrapper around `extra.sendNotification` for progress events.
 *
 * The MCP SDK's `sendNotification` is async and may either throw synchronously
 * (e.g. `assertNotificationCapability` if the host hasn't advertised the
 * capability) or reject the returned Promise. Both kinds of failures must be
 * swallowed — progress notifications are non-essential, and any leak ends up
 * as an unhandled rejection that takes down the entire MCP process.
 *
 * Use this from any socket-driven progress callback rather than calling
 * `sendNotification` directly.
 */
export interface ToolExtraLike {
    sendNotification?: (notification: {
        method: 'notifications/message';
        params: { level: 'info'; logger: string; data: string };
    }) => void | Promise<void>;
}

export function safeSendLog(
    extra: ToolExtraLike | undefined,
    logger: string,
    data: string,
): void {
    const send = extra?.sendNotification;
    if (typeof send !== 'function') return;
    try {
        const result = send({
            method: 'notifications/message',
            params: { level: 'info', logger, data },
        });
        // Catch async rejections without awaiting so the caller stays sync.
        if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).catch(() => { /* best-effort */ });
        }
    } catch {
        // Best-effort: never let progress delivery crash the tool.
    }
}
