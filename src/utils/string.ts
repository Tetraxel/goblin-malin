// Strips C0 control chars (0x00–0x1F), DEL (0x7F), and C1 control chars (0x80–0x9F)
export function sanitizeInput(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export function replaceAll(text: string, charsToReplace: string, replaceValue: string): string {
    if (!text) return text;

    const regex = new RegExp(`[${charsToReplace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]`, "g");
    return text.replace(regex, replaceValue).replace(/\s+/g, " ");
}

/** "3s ago" / "2m ago" / "1h ago" — coarsest unit that fits, floor-rounded. */
export function formatRelativeTime(elapsedMs: number): string {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
