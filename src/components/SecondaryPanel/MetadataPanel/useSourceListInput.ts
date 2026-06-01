import React from "react";
import open from "open";
import clipboard from "clipboardy";
import { MetadataGroupState } from "#flows/musicDownloadFlow/types";
import { CursorPosition } from "#hooks/useFocusManager";
import { useShortcuts } from "#hooks/useShortcuts";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";

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
    // Focused result metadata (for hint line left content)
    const focusedResult =
        cursor.type === "result"
            ? (() => {
                  const group = sortedGroups[cursor.groupIndex];
                  const sorted = group ? [...group.results].sort((a, b) => a.rank - b.rank) : [];
                  return sorted[cursor.resultIndex];
              })()
            : undefined;

    const focusedGroup = cursor.type === "group" ? sortedGroups[cursor.groupIndex] : undefined;

    const uri = focusedResult?.metadata
        ? (focusedResult.metadata.uri ??
          `${focusedResult.metadata.platform.toUpperCase()}::TRACK::${focusedResult.metadata.id}`)
        : "";

    const totalInGroup = cursor.type === "result" ? (sortedGroups[cursor.groupIndex]?.results.length ?? 0) : 0;

    const groupDisplay = focusedGroup ? providerDisplayRegistry.get(focusedGroup.serviceKey) : null;

    // ── Hint lines ────────────────────────────────────────────────────────────

    const hintLines = (() => {
        if (cursor.type === "result" && focusedResult) {
            return [
                {
                    id: "sourceList.line.uri",
                    left: {
                        type: "node" as const,
                        renderNode: (dimmed: boolean) =>
                            React.createElement(Uri, { uri, platform: focusedResult.metadata.platform, dimmed }),
                        nodeKey: uri,
                    },
                    shortcutIds: ["sourceList.enter", "sourceList.copy"],
                },
                {
                    id: "sourceList.line.position",
                    left: {
                        type: "text" as const,
                        value: `Source ${cursor.resultIndex + 1}/${totalInGroup}`,
                        bold: true,
                    },
                    shortcutIds: [
                        "sourceList.fav",
                        "sourceList.reject",
                        "sourceList.moveUp",
                        "sourceList.moveDown",
                        "sourceList.refetch",
                    ],
                },
            ];
        }
        if (cursor.type === "group" && focusedGroup) {
            return [
                {
                    id: "sourceList.line.group",
                    left: {
                        type: "text" as const,
                        value: groupDisplay?.label ?? focusedGroup.serviceKey,
                        color: groupDisplay?.color,
                        bold: true,
                    },
                    shortcutIds: ["sourceList.reject", "sourceList.moveUp", "sourceList.moveDown"],
                },
            ];
        }
        return [
            {
                id: "sourceList.line.compiled",
                left: { type: "text" as const, value: "Compiled Metadata", bold: true },
                shortcutIds: [],
            },
        ];
    })();

    // ── Shortcuts ─────────────────────────────────────────────────────────────

    useShortcuts({
        id: "sourceList",
        isActive,
        priority: 150,
        shortcuts: [
            {
                id: "sourceList.up",
                defaultShortcut: { key: "upArrow" },
                label: "Navigate up",
                handler: () => {
                    const flatItems = buildFlatOrder(sortedGroups);
                    const idx = cursorToFlatIndex(cursor, flatItems);
                    if (idx > 0) onCursorChange(flatItemToCursor(flatItems[idx - 1]));
                },
            },
            {
                id: "sourceList.down",
                defaultShortcut: { key: "downArrow" },
                label: "Navigate down",
                handler: () => {
                    const flatItems = buildFlatOrder(sortedGroups);
                    const idx = cursorToFlatIndex(cursor, flatItems);
                    if (idx < flatItems.length - 1) onCursorChange(flatItemToCursor(flatItems[idx + 1]));
                },
            },
            {
                id: "sourceList.moveUp",
                defaultShortcut: { key: "upArrow", shift: true },
                label: "Move up",
                handler: () => {
                    if (cursor.type === "group") {
                        const gi = cursor.groupIndex;
                        if (gi <= 0) return;
                        const above = sortedGroups[gi - 1];
                        const current = sortedGroups[gi];
                        onGroupsChange(
                            groups.map((g) => {
                                if (g === current) return { ...g, rank: above.rank };
                                if (g === above) return { ...g, rank: current.rank };
                                return g;
                            })
                        );
                        onCursorChange({ type: "group", groupIndex: gi - 1 });
                    } else if (cursor.type === "result") {
                        const { groupIndex: gi, resultIndex: ri } = cursor;
                        const group = sortedGroups[gi];
                        const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                        if (ri <= 0) return;
                        const above = sortedResults[ri - 1];
                        const current = sortedResults[ri];
                        const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                        if (!origGroup) return;
                        onGroupsChange(
                            groups.map((g) =>
                                g === origGroup
                                    ? {
                                          ...g,
                                          results: origGroup.results.map((r) => {
                                              if (r === current) return { ...r, rank: above.rank };
                                              if (r === above) return { ...r, rank: current.rank };
                                              return r;
                                          }),
                                      }
                                    : g
                            )
                        );
                        onCursorChange({ type: "result", groupIndex: gi, resultIndex: ri - 1 });
                    }
                },
            },
            {
                id: "sourceList.moveDown",
                defaultShortcut: { key: "downArrow", shift: true },
                label: "Move down",
                handler: () => {
                    if (cursor.type === "group") {
                        const gi = cursor.groupIndex;
                        if (gi >= sortedGroups.length - 1) return;
                        const below = sortedGroups[gi + 1];
                        const current = sortedGroups[gi];
                        onGroupsChange(
                            groups.map((g) => {
                                if (g === current) return { ...g, rank: below.rank };
                                if (g === below) return { ...g, rank: current.rank };
                                return g;
                            })
                        );
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
                        onGroupsChange(
                            groups.map((g) =>
                                g === origGroup
                                    ? {
                                          ...g,
                                          results: origGroup.results.map((r) => {
                                              if (r === current) return { ...r, rank: below.rank };
                                              if (r === below) return { ...r, rank: current.rank };
                                              return r;
                                          }),
                                      }
                                    : g
                            )
                        );
                        onCursorChange({ type: "result", groupIndex: gi, resultIndex: ri + 1 });
                    }
                },
            },
            {
                id: "sourceList.focusDetail",
                defaultShortcut: { key: "rightArrow" },
                label: "Details",
                handler: () => onInnerFocusSwitch(),
            },
            {
                id: "sourceList.enter",
                defaultShortcut: { key: "return" },
                label: "Open link",
                handler: () => {
                    if (cursor.type !== "result") return;
                    const url = sortedGroups[cursor.groupIndex]?.results[cursor.resultIndex]?.metadata.url;
                    if (url) open(toOpenableUri(url)).catch(() => {});
                },
            },
            {
                id: "sourceList.copy",
                defaultShortcut: { input: "c", ctrl: true },
                label: "Copy link",
                handler: () => {
                    if (cursor.type !== "result") return;
                    const url = sortedGroups[cursor.groupIndex]?.results[cursor.resultIndex]?.metadata.url;
                    if (url)
                        try {
                            clipboard.writeSync(url);
                        } catch {
                            /* ignored */
                        }
                },
            },
            {
                id: "sourceList.fav",
                defaultShortcut: { input: "f" },
                label: "Favorite",
                handler: () => {
                    if (cursor.type !== "result") return;
                    const { groupIndex: gi, resultIndex: ri } = cursor;
                    const group = sortedGroups[gi];
                    if (!group) return;
                    const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                    const result = sortedResults[ri];
                    if (!result) return;
                    const newFav = !result.isFavorited;
                    const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                    if (!origGroup) return;
                    onGroupsChange(
                        groups.map((g) =>
                            g === origGroup
                                ? {
                                      ...g,
                                      results: origGroup.results.map((r) => ({
                                          ...r,
                                          isFavorited: r === result ? newFav : false,
                                          isRejected: r === result && newFav ? false : r.isRejected,
                                      })),
                                  }
                                : g
                        )
                    );
                },
            },
            {
                id: "sourceList.reject",
                defaultShortcut: { key: "delete" },
                label: "Reject",
                handler: () => {
                    if (cursor.type === "result") {
                        const { groupIndex: gi, resultIndex: ri } = cursor;
                        const group = sortedGroups[gi];
                        const sortedResults = [...group.results].sort((a, b) => a.rank - b.rank);
                        const result = sortedResults[ri];
                        if (!result) return;
                        const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                        if (!origGroup) return;
                        const newRejected = !result.isRejected;
                        onGroupsChange(
                            groups.map((g) =>
                                g === origGroup
                                    ? {
                                          ...g,
                                          results: origGroup.results.map((r) =>
                                              r === result
                                                  ? {
                                                        ...r,
                                                        isRejected: newRejected,
                                                        isFavorited: newRejected ? false : r.isFavorited,
                                                    }
                                                  : r
                                          ),
                                      }
                                    : g
                            )
                        );
                    } else if (cursor.type === "group") {
                        const group = sortedGroups[cursor.groupIndex];
                        const origGroup = groups.find((g) => g.serviceKey === group.serviceKey);
                        if (!origGroup) return;
                        const allRejected = origGroup.results.every((r) => r.isRejected);
                        onGroupsChange(
                            groups.map((g) =>
                                g === origGroup
                                    ? {
                                          ...g,
                                          results: origGroup.results.map((r) => ({
                                              ...r,
                                              isRejected: !allRejected,
                                              isFavorited: !allRejected ? false : r.isFavorited,
                                          })),
                                      }
                                    : g
                            )
                        );
                    }
                },
            },
            {
                id: "sourceList.toggleDiscovery",
                defaultShortcut: { input: "e" },
                label: "Toggle details",
                handler: () => onToggleDiscoverySources(),
            },
            {
                id: "sourceList.refetch",
                defaultShortcut: { input: "r" },
                label: "Refetch",
                handler: () => {
                    if (cursor.type !== "result") return;
                    onRefetchResult(cursor.groupIndex, cursor.resultIndex);
                },
            },
        ],
        hintLines,
    });
}
