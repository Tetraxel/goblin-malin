/** "just now", "5 min ago", "3 h ago", "2 days ago": how long ago something was, roughly. */
export function timeAgo(date: Date, now: number = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}
