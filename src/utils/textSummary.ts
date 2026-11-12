/** Cuts `text` to at most `max` characters: whitespace collapsed, cut at a word, "…" when something was left out. */
export function clipText(text: string, max: number): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The first sentence of a text (the whole text when it has no sentence end). */
export function firstSentence(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    const end = clean.search(/[.!?](\s|$)/);
    return end === -1 ? clean : clean.slice(0, end + 1);
}
