import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { actionsMenuRegistry, type ActionsMenuItem } from "#base/actionsMenu";
import { globalLogger } from "#base/logger/logger";
import { mouseRegistry } from "#base/mouse/mouse";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { toolbarAnchor } from "#base/toolbarAnchor";
import { useTheme } from "#base/themeContext";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useShortcuts } from "#hooks/useShortcuts";
import { Hint } from "../Hint";

const logger = globalLogger.createChild({ service: "ActionsMenu" });

const MIN_WIDTH = 44;
const MAX_WIDTH = 78;

type Row = { item: ActionsMenuItem; reason: string | undefined };

const MenuRow = React.memo(function MenuRow({
    row,
    selected,
    onChoose,
}: {
    row: Row;
    selected: boolean;
    onChoose: () => void;
}) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    // Only while the menu is the focused window: the toolbar and the list underneath must not react.
    useClickTarget(ref, onChoose, { window: "actionsMenu" });
    const hovered = useHoverTarget(ref, { window: "actionsMenu" });
    const disabled = row.reason !== undefined;
    const highlighted = selected || hovered;
    return (
        <Box
            ref={ref}
            flexDirection="column"
            flexShrink={0}
            backgroundColor={highlighted ? theme.ui.rowBackground.regular.hover : undefined}
        >
            <Box flexDirection="row">
                <Box width={2} flexShrink={0}>
                    <Text color={theme.ui.focusIndicator}>{selected ? "☛" : ""}</Text>
                </Box>
                <Text bold={highlighted && !disabled} dimColor={disabled} wrap="truncate-end">
                    {row.item.label}
                </Text>
            </Box>
            <Box marginLeft={2}>
                <Text color={disabled ? theme.status.warning : theme.text.secondary} wrap="truncate-end">
                    {disabled ? row.reason : row.item.description}
                </Text>
            </Box>
        </Box>
    );
});

/**
 * The drop-down under the toolbar's "Actions" button: things to do to the whole list. What it offers is whatever was
 * registered with `actionsMenuRegistry`. ↑/↓ and Enter, or a click, choose; Esc or a click anywhere else closes it.
 * An item that cannot be used right now stays listed, greyed, with the reason in place of its description.
 */
export const ActionsMenu: React.FC<{ terminalWidth: number; terminalHeight: number }> = ({
    terminalWidth,
    terminalHeight,
}) => {
    const theme = useTheme();
    const { switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const isOpen = activeWindow === "actionsMenu";
    const menuRef = useRef<DOMElement>(null);
    const [selected, setSelected] = useState(0);

    // What is available is asked each time the menu opens, never kept from before.
    const rows = useMemo<Row[]>(
        () => (isOpen ? actionsMenuRegistry.list().map((item) => ({ item, reason: item.unavailableReason?.() })) : []),
        [isOpen]
    );

    const [wasOpen, setWasOpen] = useState(isOpen);
    if (wasOpen !== isOpen) {
        setWasOpen(isOpen);
        if (isOpen) setSelected(0);
    }

    const close = () => switchBack();
    const choose = (index: number) => {
        const row = rows[index];
        if (!row || row.reason !== undefined) return;
        // Focus goes back first, and the action runs a tick later: one that opens a dialog must open it from there.
        close();
        setTimeout(() => {
            Promise.resolve()
                .then(() => row.item.run())
                .catch((error) => logger.error(`Action "${row.item.id}" failed`, { error }));
        }, 0);
    };

    useShortcuts({
        id: "actionsMenu",
        isActive: isOpen,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "actionsMenu.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setSelected((s) => (rows.length === 0 ? 0 : (s - 1 + rows.length) % rows.length)),
            },
            {
                id: "actionsMenu.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setSelected((s) => (rows.length === 0 ? 0 : (s + 1) % rows.length)),
            },
            {
                id: "actionsMenu.confirm",
                defaultShortcut: { key: "return" },
                label: "Choose",
                handler: () => choose(selected),
            },
            {
                id: "actionsMenu.cancel",
                defaultShortcut: { key: "escape" },
                label: "Close",
                handler: close,
            },
        ],
    });

    // A click anywhere outside the menu closes it. (The press that opened it was dispatched before this subscribed.)
    const closeRef = useRef(close);
    useEffect(() => {
        closeRef.current = close;
    });
    useEffect(() => {
        if (!isOpen) return;
        return mouseRegistry.subscribe((event) => {
            if (event.type !== "press" || event.button !== "left") return;
            const bounds = getScreenBounds(menuRef.current);
            const inside =
                !!bounds &&
                event.x >= bounds.x &&
                event.x < bounds.x + bounds.width &&
                event.y >= bounds.y &&
                event.y < bounds.y + bounds.height;
            if (!inside) closeRef.current();
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const wanted = Math.max(
        MIN_WIDTH,
        ...rows.map(({ item, reason }) => 2 + Math.max(item.label.length, (reason ?? item.description).length) + 6)
    );
    const width = Math.min(MAX_WIDTH, wanted, terminalWidth);
    const anchor = toolbarAnchor.get();
    // Under the button, lined up with its left edge, and never off the right side of the screen.
    const left = Math.max(0, Math.min(anchor?.x ?? 0, terminalWidth - width));
    const top = anchor ? anchor.y + anchor.height : 2;

    return (
        <Box position="absolute" top={Math.min(top, Math.max(0, terminalHeight - 6))} left={left}>
            <Box
                ref={menuRef}
                flexDirection="column"
                borderStyle="round"
                borderColor={theme.ui.modalBorder}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={1}
                width={width}
                flexShrink={0}
            >
                {rows.length === 0 ? (
                    <Text color={theme.text.secondary}>Nothing to do here yet.</Text>
                ) : (
                    rows.map((row, i) => (
                        <Box key={row.item.id} flexDirection="column" marginBottom={i < rows.length - 1 ? 1 : 0}>
                            <MenuRow row={row} selected={i === selected} onChoose={() => choose(i)} />
                        </Box>
                    ))
                )}
                <Box marginTop={1} flexDirection="row">
                    <Hint label="Choose" shortcutId="actionsMenu.confirm" />
                    <Hint label="Select" shortcutIds={["actionsMenu.up", "actionsMenu.down"]} />
                    <Hint label="Close" shortcutId="actionsMenu.cancel" />
                </Box>
            </Box>
        </Box>
    );
};
