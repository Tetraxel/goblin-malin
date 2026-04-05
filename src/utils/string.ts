export function replaceAll(
    text: string,
    charsToReplace: string,
    replaceValue: string,
): string {
    if (!text) return text;

    const regex = new RegExp(`[${charsToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`, 'g');
    return text.replace(regex, replaceValue).replace(/\s+/g, ' ');
}