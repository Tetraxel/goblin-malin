import { useInput } from "ink";
import open from "open";
import clipboard from "clipboardy";
import { MetadataGroupState } from "#flows/musicDownloadFlow/types";
import { CursorPosition } from "#hooks/useFocusManager";

interface UseSourceListInputParams {
    groups: MetadataGroupState[];
    sortedGroups: MetadataGroupState[];
    cursor: CursorPosition;
    isActive: boolean;
    onCursorChange: (cursor: CursorPosition) => void;
    onInnerFocusSwitch: () => void;
    onGroupsChange: (groups: MetadataGroupState[]) => void;
    onToggleDiscoverySources: () => void;
    onRefetchResult: (groupIndex: number, resultIndex: number) => void;
}

function toOpenableUri(url: string): string {
    const m = url.match(/open\.spotify\.com\/(track|album|artist|playlist)\/([A-Za-z0-9]+)/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    return url;
}

// Flat traversal order: compiled → group[0] header → result[0][0] → result[0][1] → … → group[1] header → …
type FlatItem =
    | { kind: "compiled" }
    | { kind: "group"; groupIndex: number }
    | { kind: "result"; groupIndex: number; resultIndex: number };

function buildFlatOrder(sortedGroups: MetadataGroupState[]): FlatItem[] {
    const items: FlatItem[] = [{ kind: "compiled" }];
    for (let gi = 0; gi < sortedGroups.length; gi++) {
        items.push({ kind: "group", groupIndex: gi });
        const sortedResults = [...sortedGroups[gi].results].sort((a, b) => a.rank - b.rank);
        for (let ri = 0; ri < sortedResults.length; ri++) {
            items.push({ kind: "result", groupIndex: gi, resultIndex: ri });
        }
    }
    return items;
}

function flatItemToCursor(item: FlatItem): CursorPosition {
    if (item.kind === "compiled") return { type: "compiled" };
    if (item.kind === "group") return { type: "group", groupIndex: item.groupIndex };
    return { type: "result", groupIndex: item.groupIndex, resultIndex: item.resultIndex };
}

function cursorToFlatIndex(cursor: CursorPosition, items: FlatItem[]): number {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (cursor.type === "compiled" && item.kind === "compiled") return i;
        if (cursor.type === "group" && item.kind === "group" && item.groupIndex === cursor.groupIndex) return i;
        if (
            cursor.type === "result" &&
            item.kind === "result" &&
            item.groupIndex === cursor.groupIndex &&
            item.resultIndex === cursor.resultIndex
        )
            return i;
    }
    return 0;
}

export function useSourceListInput({
    groups,
    sortedGroups,
    cursor,
    isActive,
    onCursorChange,
    onInnerFocusSwitch,
    onGroupsChange,
    onToggleDiscoverySources,
    onRefetchResult,
}: UseSourceListInputParams) {
    useInput(
        (input, key) => {
            const flatItems = buildFlatOrder(sortedGroups);
            const currentFlatIdx = cursorToFlatIndex(cursor, flatItems);

            if (key.upArrow) {
                if (key.shift) {
                    // Shift+↑: swap rank with item above, cursor follows
                    if (cursor.type === "group") {
                        const gi = cursor.groupIndex;
                        if (gi <= 0) return;
                        const above = sortedGroups[gi - 1];
                        const current = sortedGroups[gi];
                        const updated = groups.map((g) => {
                            if (g === current) return { ...g, rank: above.rank };
                            if (g === above) return { ...g, rank: current.rank };
                            return g;
                        });
                        onGroupsChange(updated);
                        onCursorChange({ type: "group", groupIndex: gi - 1 });
                    } else if (cursor.type === "result") {
                        const { groupIndex: gi, resultIndex: ri } = cursor;
                        const group = sortedGroups[gi];
                        const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                        if (ri <= 0) return;
                        const above = sortedResults[ri - 1];
                        const current = sortedResults[ri];
                        const origGroup = groups.find((g) => g === group || g.serviceKey === group.serviceKey);
                        if (!origGroup) return;
                        const updatedResults = origGroup.results.map((r) => {
                            if (r === current) return { ...r, rank: above.rank };
                            if (r === above) return { ...r, rank: current.rank };
                            return r;
                        });
                        onGroupsChange(groups.map((g) => (g === origGroup ? { ...g, results: updatedResults } : g)));
                        onCursorChange({ type: "result", groupIndex: gi, resultIndex: ri - 1 });
                    }
                    return;
                }
                if (currentFlatIdx > 0) {
                    onCursorChange(flatItemToCursor(flatItems[currentFlatIdx - 1]));
                }
                return;
            }

            if (key.downArrow) {
                if (key.shift) {
                    // Shift+↓: swap rank with item below, cursor follows
                    if (cursor.type === "group") {
                        const gi = cursor.groupIndex;
                        if (gi >= sortedGroups.length - 1) return;
                        const below = sortedGroups[gi + 1];
                        const current = sortedGroups[gi];
                        const updated = groups.map((g) => {
                            if (g === current) return { ...g, rank: below.rank };
                            if (g === below) return { ...g, rank: current.rank };
                            return g;
                        });
                        onGroupsChange(updated);
                        onCursorChange({ type: "group", groupIndex: gi + 1 });
                    } else if (cursor.type === "result") {
                        const { groupIndex: gi, resultIndex: ri } = cursor;
                        const group = sortedGroups[gi];
                        const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                        if (ri >= sortedResults.length - 1) return;
                        const below = sortedResults[ri + 1];
                        const current = sortedResults[ri];
                        const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                        if (!origGroup) return;
                        const updatedResults = origGroup.results.map((r) => {
                            if (r === current) return { ...r, rank: below.rank };
                            if (r === below) return { ...r, rank: current.rank };
                            return r;
                        });
                        onGroupsChange(groups.map((g) => (g === origGroup ? { ...g, results: updatedResults } : g)));
                        onCursorChange({ type: "result", groupIndex: gi, resultIndex: ri + 1 });
                    }
                    return;
                }
                if (currentFlatIdx < flatItems.length - 1) {
                    onCursorChange(flatItemToCursor(flatItems[currentFlatIdx + 1]));
                }
                return;
            }

            if (key.rightArrow && !key.shift) {
                onInnerFocusSwitch();
                return;
            }

            // [Enter] — open URL of focused result
            if (key.return && cursor.type === "result") {
                const url = sortedGroups[cursor.groupIndex]?.results[cursor.resultIndex]?.metadata.url;
                if (url) open(toOpenableUri(url)).catch(() => {});
                return;
            }

            // [Ctrl+C] — copy URL of focused result
            if (key.ctrl && input === "c" && cursor.type === "result") {
                const url = sortedGroups[cursor.groupIndex]?.results[cursor.resultIndex]?.metadata.url;
                if (url)
                    try {
                        clipboard.writeSync(url);
                    } catch {
                        /* ignored */
                    }
                return;
            }

            // [F] — favorite/unfavorite focused result
            if ((input === "f" || input === "F") && cursor.type === "result") {
                const { groupIndex: gi, resultIndex: ri } = cursor;
                const group = sortedGroups[gi];
                if (!group) return;
                const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                const result = sortedResults[ri];
                if (!result) return;
                const newFav = !result.isFavorited;
                const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                if (!origGroup) return;
                const updatedResults = origGroup.results.map((r) => ({
                    ...r,
                    isFavorited: r === result ? newFav : false,
                    isRejected: r === result && newFav ? false : r.isRejected,
                }));
                onGroupsChange(groups.map((g) => (g === origGroup ? { ...g, results: updatedResults } : g)));
                return;
            }

            // [Del] — reject/unreject
            if (key.delete) {
                if (cursor.type === "result") {
                    const { groupIndex: gi, resultIndex: ri } = cursor;
                    const group = sortedGroups[gi];
                    const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                    const result = sortedResults[ri];
                    if (!result) return;
                    const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                    if (!origGroup) return;
                    const newRejected = !result.isRejected;
                    const updatedResults = origGroup.results.map((r) =>
                        r === result
                            ? { ...r, isRejected: newRejected, isFavorited: newRejected ? false : r.isFavorited }
                            : r
                    );
                    onGroupsChange(groups.map((g) => (g === origGroup ? { ...g, results: updatedResults } : g)));
                } else if (cursor.type === "group") {
                    const group = sortedGroups[cursor.groupIndex];
                    const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                    if (!origGroup) return;
                    const allRejected = origGroup.results.every((r) => r.isRejected);
                    const updatedResults = origGroup.results.map((r) => ({
                        ...r,
                        isRejected: !allRejected,
                        isFavorited: !allRejected ? false : r.isFavorited,
                    }));
                    onGroupsChange(groups.map((g) => (g === origGroup ? { ...g, results: updatedResults } : g)));
                }
                return;
            }

            // [E] — toggle discovery source lines
            if (input === "e" || input === "E") {
                onToggleDiscoverySources();
                return;
            }

            // [R] — refetch focused result
            if ((input === "r" || input === "R") && !key.shift && cursor.type === "result") {
                onRefetchResult(cursor.groupIndex, cursor.resultIndex);
                return;
            }
        },
        { isActive }
    );
}
