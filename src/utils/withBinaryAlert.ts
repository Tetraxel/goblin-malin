import { binaryAlertBridge } from "#base/bridges/binaryAlertBridge";

/**
 * Runs a tool's setup routine (find or download the binary) and, when it fails, tells the user through
 * the UI instead of leaving the failure in a log. The error itself is rethrown unchanged, so callers keep
 * their own handling (a failed row, a best-effort `null`…); a success re-arms the alert for next time.
 *
 * A setup that falls back to an older copy of the tool *succeeds* and does not alert: the tool exists.
 */
export async function withBinaryAlert<T>(binary: string, impact: string, setup: () => Promise<T>): Promise<T> {
    try {
        const result = await setup();
        binaryAlertBridge.resolved(binary);
        return result;
    } catch (error) {
        binaryAlertBridge.report({
            binary,
            impact,
            reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
