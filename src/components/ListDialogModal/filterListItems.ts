/** Lower case, without accents: "Démucs" finds "demucs". */
const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The items whose label or detail lines hold every word of `query` (all of them when it is empty). */
export function filterListItems<T extends { label: string; detail?: string[] }>(
    items: readonly T[],
    query: string
): number[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const out: number[] = [];
    items.forEach((item, i) => {
        const text = fold([item.label, ...(item.detail ?? [])].join(" "));
        if (words.every((w) => text.includes(w))) out.push(i);
    });
    return out;
}
