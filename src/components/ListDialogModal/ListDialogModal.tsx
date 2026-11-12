import React, { useEffect, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import Spinner from "ink-spinner";
import open from "open";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { siteLabel, siteProviderKey } from "#utils/appLinks";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { type DialogLink, type ListAnswer, type ListDialog, type ListDialogBody } from "#base/bridges/dialogBridge";
import { Hint } from "../Hint";

export type PendingListDialog = {
    dialog: ListDialog;
    resolve: (answer: ListAnswer) => void;
};

interface ListDialogModalProps {
    pending: PendingListDialog | null;
    terminalHeight: number;
    terminalWidth: number;
    onAnswer: (answer: ListAnswer) => void;
}

// Rows the frame, title, intro and hints take around the list.
const CHROME_ROWS = 12;

/** The most links one item can show. */
const MAX_LINKS = 6;

/** An address without its scheme: `https://open.spotify.com/album/x` → `open.spotify.com/album/x`. */
const bare = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, "");

/**
 * A page about an item, as one line: `└─  Spotify  open.spotify.com/album/…`. The site's name is in its own color (the
 * provider's, when the app knows it) and never underlined; the address is plain, and underlined only while the pointer
 * is over it. A click opens `target` — the desktop app's address when there is one (`spotify:album:…`), the page itself
 * otherwise. `labelWidth` pads the names so the addresses line up.
 */
const LinkLine = React.memo(function LinkLine({
    label,
    providerKey,
    text,
    target,
    labelWidth,
}: {
    label: string;
    providerKey?: string;
    text: string;
    target: string;
    labelWidth: number;
}) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    // Only while this dialog is the focused window: it must not react to the app underneath.
    useClickTarget(ref, () => void open(target).catch(() => {}), { window: "listDialog" });
    const hovered = useHoverTarget(ref, { window: "listDialog" });
    const color = providerKey ? providerDisplayRegistry.get(providerKey).color : theme.text.primary;
    return (
        <Box ref={ref} marginLeft={2} flexShrink={0} flexDirection="row">
            <Box flexShrink={0}>
                <Text color={theme.text.secondary}>{"└─ "}</Text>
            </Box>
            <Box flexShrink={0} width={labelWidth + 2}>
                <Text color={color} wrap="truncate-end">
                    {label}
                </Text>
            </Box>
            <Text color={hovered ? theme.text.active : theme.text.secondary} underline={hovered} wrap="truncate-end">
                {text}
            </Text>
        </Box>
    );
});

/**
 * A pick-one list with detail lines under each row, plus an optional "none of these" row. Opened through
 * `dialogBridge.choose` (e.g. "which MusicBrainz release is this?"). Enter answers, Esc dismisses.
 */
export const ListDialogModal: React.FC<ListDialogModalProps> = ({
    pending,
    terminalHeight,
    terminalWidth,
    onAnswer,
}) => {
    const theme = useTheme();
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const [selected, setSelected] = useState(0);

    const [prevPending, setPrevPending] = useState(pending);
    if (prevPending !== pending) {
        setPrevPending(pending);
        setSelected(0);
    }

    useEffect(() => {
        if (!pending) return;
        switchWindow("listDialog");
        return () => {
            switchBack();
        };
    }, [pending, switchWindow, switchBack]);

    // A dialog whose content is still on its way opens at once with a loader; the body replaces it when it arrives.
    // A body that is empty (null) or failed has nothing to show: the dialog closes, answered `null`.
    const [loaded, setLoaded] = useState<{ pending: PendingListDialog; body: ListDialogBody } | null>(null);
    useEffect(() => {
        const body = pending?.dialog.body;
        if (!pending || !body) return;
        let stale = false;
        body.then(
            (content) => {
                if (stale) return;
                if (content) setLoaded({ pending, body: content });
                else onAnswer(null);
            },
            () => {
                if (!stale) onAnswer(null);
            }
        );
        return () => {
            stale = true;
        };
        // `onAnswer` of the render that opened this dialog is the right one (it closes over this `pending`).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending]);

    const loadedBody = loaded && loaded.pending === pending ? loaded.body : undefined;
    const loading = !!pending?.dialog.body && !loadedBody;
    const dialog = pending ? { ...pending.dialog, ...loadedBody } : undefined;
    const rowCount = loading ? 0 : (dialog?.items.length ?? 0) + (dialog?.noneLabel ? 1 : 0);
    const isActive = pending !== null && activeWindow === "listDialog";

    useShortcuts({
        id: "listDialog",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "listDialog.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setSelected((s) => (rowCount === 0 ? 0 : (s - 1 + rowCount) % rowCount)),
            },
            {
                id: "listDialog.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setSelected((s) => (rowCount === 0 ? 0 : (s + 1) % rowCount)),
            },
            {
                id: "listDialog.confirm",
                defaultShortcut: { key: "return" },
                label: "Choose",
                handler: () => {
                    if (!dialog || loading) return;
                    onAnswer(selected < dialog.items.length ? { index: selected } : { none: true });
                },
            },
            {
                id: "listDialog.open",
                defaultShortcut: { input: "o" },
                label: "Open in browser",
                handler: () => {
                    const url = dialog?.items[selected]?.url;
                    if (url) open(url).catch(() => {});
                },
            },
            {
                id: "listDialog.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => onAnswer(null),
            },
        ],
    });

    if (!pending || !dialog) return null;

    const accent = dialog.accent ?? theme.ui.modalBorder;
    const modalWidth = Math.min(100, Math.max(44, terminalWidth - 8));

    // Rows as the list draws them: the items, then the "none" row. Show the stretch around the selection that fits.
    const rows: { label: string; detail: string[]; url?: string; links: DialogLink[] }[] = [
        ...dialog.items.map((item) => ({
            label: item.label,
            detail: item.detail ?? [],
            url: item.url,
            links: (item.links ?? []).slice(0, MAX_LINKS),
        })),
        ...(dialog.noneLabel ? [{ label: dialog.noneLabel, detail: [] as string[], links: [] as DialogLink[] }] : []),
    ];
    const budget = Math.max(4, terminalHeight - CHROME_ROWS);
    let start = 0;
    // A row's height: its label, its detail lines, its links and, between records, a blank line.
    const heightOf = (i: number) => 1 + rows[i].detail.length + rows[i].links.length + (i < rows.length - 1 ? 1 : 0);
    const span = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i <= to; i++) sum += heightOf(i);
        return sum;
    };
    while (start < selected && span(start, selected) > budget) start++;
    let end = start;
    while (end + 1 < rows.length && span(start, end + 1) <= budget) end++;

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box width="100%" justifyContent="center">
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={accent}
                    borderBackgroundColor={theme.ui.background}
                    backgroundColor={theme.ui.background}
                    paddingX={2}
                    paddingY={1}
                    width={modalWidth}
                    flexShrink={0}
                >
                    <Text bold color={accent}>
                        {dialog.title}
                    </Text>
                    {dialog.intro && (
                        <Box marginTop={1}>
                            <Text>{dialog.intro}</Text>
                        </Box>
                    )}

                    {loading && (
                        <Box marginTop={1}>
                            <Text color={theme.text.secondary}>
                                <Spinner type="dots" /> {dialog.loadingLabel ?? "Loading…"}
                            </Text>
                        </Box>
                    )}

                    <Box marginTop={loading ? 0 : 1} flexDirection="column">
                        {start > 0 && <Text color={theme.text.secondary}>↑ more</Text>}
                        {rows.slice(start, end + 1).map((row, offset) => {
                            const i = start + offset;
                            const isSelected = i === selected;
                            // The item's own page (when it has one) lines up with its other pages.
                            const labelWidth = Math.max(
                                row.url ? siteLabel(row.url).length : 0,
                                ...row.links.map((l) => l.label.length)
                            );
                            return (
                                <Box key={i} flexDirection="column" marginBottom={i < rows.length - 1 ? 1 : 0}>
                                    <Box flexDirection="row">
                                        <Box width={2} flexShrink={0}>
                                            <Text color={theme.ui.focusIndicator}>{isSelected ? "☛" : ""}</Text>
                                        </Box>
                                        <Text bold={isSelected} wrap="truncate-end">
                                            {row.label}
                                        </Text>
                                    </Box>
                                    {row.detail.map((line, d) =>
                                        row.url && line === row.url ? (
                                            <LinkLine
                                                key={d}
                                                label={siteLabel(row.url)}
                                                providerKey={siteProviderKey(row.url)}
                                                text={bare(row.url)}
                                                target={row.url}
                                                labelWidth={labelWidth}
                                            />
                                        ) : (
                                            <Box key={d} marginLeft={2}>
                                                <Text color={theme.text.secondary} wrap="truncate-end">
                                                    {line}
                                                </Text>
                                            </Box>
                                        )
                                    )}
                                    {row.links.map((link) => (
                                        <LinkLine
                                            key={link.url}
                                            label={link.label}
                                            providerKey={link.providerKey}
                                            text={bare(link.url)}
                                            target={link.openUrl}
                                            labelWidth={labelWidth}
                                        />
                                    ))}
                                </Box>
                            );
                        })}
                        {end < rows.length - 1 && <Text color={theme.text.secondary}>↓ more</Text>}
                    </Box>

                    <Box marginTop={1} flexDirection="row">
                        {!loading && <Hint label="Choose" shortcutId="listDialog.confirm" />}
                        {!loading && <Hint label="Select" shortcutIds={["listDialog.up", "listDialog.down"]} />}
                        {!loading && rows[selected]?.url && (
                            <Hint label="Open in browser" shortcutId="listDialog.open" />
                        )}
                        <Hint label="Cancel" shortcutId="listDialog.cancel" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
