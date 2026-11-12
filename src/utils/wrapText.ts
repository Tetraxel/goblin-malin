/**
 * Wraps `text` into at most `maxLines` lines of at most `width` characters, breaking between words. When the text
 * does not fit, the last line ends with "…". Existing line breaks count as spaces: this is for a short summary
 * under a row, not for layout. A word longer than a line is cut.
 */
export function wrapText(text: string, width: number, maxLines: number): string[] {
    const limit = Math.max(1, Math.floor(width));
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    let cut = false;

    const flush = (): boolean => {
        if (current === "") return true;
        if (lines.length >= maxLines) return false;
        lines.push(current);
        current = "";
        return true;
    };

    for (let word of words) {
        while (Array.from(word).length > limit) {
            // A word longer than a line: its head fills the line, the rest goes on.
            const chars = Array.from(word);
            if (current !== "" && !flush()) {
                cut = true;
                break;
            }
            if (lines.length >= maxLines) {
                cut = true;
                break;
            }
            lines.push(chars.slice(0, limit).join(""));
            word = chars.slice(limit).join("");
        }
        if (cut) break;
        const next = current === "" ? word : `${current} ${word}`;
        if (Array.from(next).length <= limit) {
            current = next;
        } else if (flush()) {
            current = word;
        } else {
            cut = true;
            break;
        }
    }
    if (!cut && current !== "" && !flush()) cut = true;

    if (cut && lines.length > 0) {
        const last = Array.from(lines[lines.length - 1]);
        lines[lines.length - 1] = `${last.slice(0, Math.max(0, limit - 1)).join("")}…`;
    }
    return lines;
}
