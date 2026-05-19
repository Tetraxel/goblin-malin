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
