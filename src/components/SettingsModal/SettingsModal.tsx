import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { FlowBase } from "#base/flow/flow-base";
import { useTheme } from "#base/themeContext";
import { useFocusContext } from "#contexts/FocusContext";
import { SettingsStore } from "#settings/settingsStore";
import { AppSettings } from "#settings/appSettings";
import { buildGlobalSettingsItems } from "#settings/buildGlobalSettingsItems";
import { filterSettingsItems, isInteractive, SettingsItem } from "#settings/buildSettingsItems";
import { deepMerge } from "#utils/deepMerge";
import { DeepPartial } from "#utils/types";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { ShortcutsTab, buildShortcutsTabItems, buildShortcutFromKey } from "./ShortcutsTab";
import { SettingsTab } from "./SettingsTab";
import { Hint } from "../Hint";

// Rows consumed by modal chrome: marginY(6) + borders(2) + paddingY(2) + title(1) + marginTop(1) + marginTop(1) + footer(1) = 14
// Search bars live inside each tab component and subtract their own SEARCH_H from the height budget.
const MODAL_OVERHEAD = 10;

type ActiveTab = "settings" | "shortcuts";

interface SettingsModalProps {
    terminalHeight: number;
    terminalWidth: number;
    currentFlow: FlowBase | undefined;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ terminalHeight, terminalWidth, currentFlow }) => {
    const theme = useTheme();
    const { focusState, switchBack, openWizard } = useFocusContext();
    const isActive = focusState.activeWindow === "settingsModal";

    const [appDraft, setAppDraft] = useState<AppSettings>(() => SettingsStore.getInstance().getAppSettings());
    const [flowPatch, setFlowPatch] = useState<Record<string, unknown>>({});
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [modalFocus, setModalFocus] = useState<"search" | "list">("search");

    const [activeTab, setActiveTab] = useState<ActiveTab>("settings");
    const [shortcutsSelectedIndex, setShortcutsSelectedIndex] = useState(0);
    const [shortcutsSearchQuery, setShortcutsSearchQuery] = useState("");
    const [shortcutsModalFocus, setShortcutsModalFocus] = useState<"search" | "list">("search");
    const [rebindingId, setRebindingId] = useState<string | null>(null);

    // Unsaved-changes confirmation when leaving with pending edits.
    const [confirmExit, setConfirmExit] = useState(false);
    const [confirmChoice, setConfirmChoice] = useState(0);

    // Reset to fresh settings when the modal opens, but NOT when returning from the wizard.
    const [prevIsActive, setPrevIsActive] = useState(isActive);
    const [prevReturningFrom, setPrevReturningFrom] = useState(focusState.returningFromWindow);
    if (prevIsActive !== isActive || prevReturningFrom !== focusState.returningFromWindow) {
        setPrevIsActive(isActive);
        setPrevReturningFrom(focusState.returningFromWindow);
        if (isActive && focusState.returningFromWindow !== "setupWizardModal") {
            setAppDraft(SettingsStore.getInstance().getAppSettings());
            setFlowPatch({});
            setSelectedIndex(0);
            setEditingIndex(null);
            setEditValue("");
            setSearchQuery("");
            setModalFocus("search");
            setActiveTab("settings");
            setShortcutsSelectedIndex(0);
            setShortcutsSearchQuery("");
            setShortcutsModalFocus("search");
            setRebindingId(null);
            setConfirmExit(false);
            setConfirmChoice(0);
            shortcutRegistry.disableRebind();
        }
    }

    const allItems = useMemo((): SettingsItem[] => {
        const globalItems = buildGlobalSettingsItems(appDraft, (patch) =>
            setAppDraft((prev) => deepMerge(prev, patch as DeepPartial<AppSettings>))
        );
        const fullFlowSettings = deepMerge(
            (currentFlow?.getFlowSettings?.() ?? {}) as Record<string, unknown>,
            flowPatch
        );
        const flowItems =
            currentFlow?.buildFlowSettingsItems?.(
                fullFlowSettings,
                (patch) => setFlowPatch((prev) => deepMerge(prev, patch) as Record<string, unknown>),
                openWizard
            ) ?? [];
        return [...globalItems, ...flowItems];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appDraft, flowPatch, currentFlow, focusState.returningFromWindow]);

    const filteredItems = useMemo(() => filterSettingsItems(allItems, searchQuery), [allItems, searchQuery]);
    const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

    // Pending edits live in `appDraft` (global) and `flowPatch` (flow). Keybinding
    // changes persist immediately, so they're never part of the unsaved state.
    const isDirty = useMemo(() => {
        const saved = SettingsStore.getInstance().getAppSettings();
        if (JSON.stringify(saved.general) !== JSON.stringify(appDraft.general)) return true;
        return Object.keys(flowPatch).length > 0;
    }, [appDraft, flowPatch]);

    const EXIT_CHOICES = ["save", "discard", "cancel"] as const;

    function commitAndExit() {
        SettingsStore.getInstance().writeAppSettings(appDraft);
        if (currentFlow?.saveFlowSettings) {
            const fullFlowSettings = deepMerge(
                (currentFlow.getFlowSettings?.() ?? {}) as Record<string, unknown>,
                flowPatch
            );
            currentFlow.saveFlowSettings(fullFlowSettings);
        }
        setConfirmExit(false);
        switchBack();
    }

    /** Exit, prompting to save/discard first if there are unsaved changes. */
    function requestExit() {
        if (isDirty) {
            setConfirmChoice(0);
            setConfirmExit(true);
            return;
        }
        switchBack();
    }

    function resolveExitChoice() {
        const choice = EXIT_CHOICES[confirmChoice];
        if (choice === "save") {
            commitAndExit();
        } else if (choice === "discard") {
            setConfirmExit(false);
            switchBack();
        } else {
            setConfirmExit(false);
        }
    }

    function startRebind(id: string) {
        setRebindingId(id);
        shortcutRegistry.enableRebind((input, key) => {
            if (key.escape) {
                setRebindingId(null);
                shortcutRegistry.disableRebind();
                return;
            }
            const newShortcut = buildShortcutFromKey(input, key);
            if (newShortcut) {
                SettingsStore.getInstance().setKeybinding(id, newShortcut);
                setAppDraft(SettingsStore.getInstance().getAppSettings());
            }
            setRebindingId(null);
            shortcutRegistry.disableRebind();
        });
    }

    useShortcuts({
        id: "settingsModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "settingsModal.save",
                defaultShortcut: { input: "s", ctrl: true },
                label: "Save & Exit",
                handler: () => {
                    if (rebindingId) return;
                    commitAndExit();
                },
            },
            {
                id: "settingsModal.escape",
                defaultShortcut: { key: "escape" },
                label: "Discard",
                handler: () => {
                    if (confirmExit) {
                        setConfirmExit(false);
                        return;
                    }
                    if (editingIndex !== null) {
                        setEditingIndex(null);
                        return;
                    }
                    if (shortcutsSearchQuery && activeTab === "shortcuts") {
                        setShortcutsSearchQuery("");
                        setShortcutsModalFocus("search");
                        return;
                    }
                    if (searchQuery && activeTab === "settings") {
                        setSearchQuery("");
                        setModalFocus("search");
                        return;
                    }
                    requestExit();
                },
            },
            {
                id: "settingsModal.switchTab",
                defaultShortcut: { key: "tab" },
                label: "Switch tab",
                handler: () => {
                    if (confirmExit || rebindingId || editingIndex !== null) return;
                    setActiveTab((t) => (t === "settings" ? "shortcuts" : "settings"));
                },
            },
            {
                id: "settingsModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (confirmExit || rebindingId) return;
                    if (activeTab === "shortcuts") {
                        if (shortcutsModalFocus === "list") {
                            if (shortcutsSelectedIndex <= 0) {
                                setShortcutsModalFocus("search");
                            } else {
                                setShortcutsSelectedIndex((prev) => prev - 1);
                            }
                        }
                        return;
                    }
                    if (modalFocus !== "list" || editingIndex !== null) return;
                    let newIdx = safeSelectedIndex - 1;
                    while (newIdx >= 0 && !isInteractive(filteredItems[newIdx])) newIdx--;
                    if (newIdx < 0) {
                        setModalFocus("search");
                        return;
                    }
                    setSelectedIndex(newIdx);
                },
            },
            {
                id: "settingsModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    if (confirmExit || rebindingId) return;
                    if (activeTab === "shortcuts") {
                        if (shortcutsModalFocus === "search") {
                            setShortcutsModalFocus("list");
                            setShortcutsSelectedIndex(0);
                        } else {
                            const items = buildShortcutsTabItems(shortcutsSearchQuery);
                            setShortcutsSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
                        }
                        return;
                    }
                    if (modalFocus === "search") {
                        const first = filteredItems.findIndex(isInteractive);
                        setSelectedIndex(first >= 0 ? first : 0);
                        setModalFocus("list");
                        return;
                    }
                    if (editingIndex !== null) return;
                    let newIdx = safeSelectedIndex + 1;
                    while (newIdx < filteredItems.length && !isInteractive(filteredItems[newIdx])) newIdx++;
                    if (newIdx < filteredItems.length) setSelectedIndex(newIdx);
                },
            },
            {
                id: "settingsModal.enter",
                defaultShortcut: { key: "return" },
                label: "Interact",
                handler: () => {
                    if (confirmExit) {
                        resolveExitChoice();
                        return;
                    }
                    if (rebindingId) return;
                    if (activeTab === "shortcuts") {
                        if (shortcutsModalFocus === "search") {
                            setShortcutsModalFocus("list");
                            setShortcutsSelectedIndex(0);
                            return;
                        }
                        const items = buildShortcutsTabItems(shortcutsSearchQuery);
                        const item = items[shortcutsSelectedIndex];
                        if (item) startRebind(item.id);
                        return;
                    }
                    if (modalFocus === "search") {
                        const first = filteredItems.findIndex(isInteractive);
                        setSelectedIndex(first >= 0 ? first : 0);
                        setModalFocus("list");
                        return;
                    }
                    if (editingIndex !== null) return;
                    const item = filteredItems[safeSelectedIndex];
                    if (!item || !isInteractive(item)) return;
                    if (item.kind === "checkbox") {
                        item.set(!item.get());
                        return;
                    }
                    if (item.kind === "textInput") {
                        setEditValue(item.get());
                        setEditingIndex(safeSelectedIndex);
                        return;
                    }
                    if (item.kind === "action") {
                        item.run();
                        return;
                    }
                },
            },
            {
                id: "settingsModal.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous",
                handler: () => {
                    if (confirmExit) {
                        setConfirmChoice((c) => (c - 1 + EXIT_CHOICES.length) % EXIT_CHOICES.length);
                        return;
                    }
                    if (activeTab !== "settings" || modalFocus !== "list" || editingIndex !== null) return;
                    const item = filteredItems[safeSelectedIndex];
                    if (!item || !isInteractive(item) || item.kind !== "select") return;
                    const curr = item.options.indexOf(item.get());
                    item.set(item.options[(curr - 1 + item.options.length) % item.options.length]);
                },
            },
            {
                id: "settingsModal.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next",
                handler: () => {
                    if (confirmExit) {
                        setConfirmChoice((c) => (c + 1) % EXIT_CHOICES.length);
                        return;
                    }
                    if (activeTab !== "settings" || modalFocus !== "list" || editingIndex !== null) return;
                    const item = filteredItems[safeSelectedIndex];
                    if (!item || !isInteractive(item) || item.kind !== "select") return;
                    const curr = item.options.indexOf(item.get());
                    item.set(item.options[(curr + 1) % item.options.length]);
                },
            },
            {
                id: "settingsModal.resetBinding",
                defaultShortcut: { key: "delete" },
                label: "Reset binding",
                handler: () => {
                    if (confirmExit || activeTab !== "shortcuts" || rebindingId) return;
                    const items = buildShortcutsTabItems(shortcutsSearchQuery);
                    const item = items[shortcutsSelectedIndex];
                    if (item) {
                        SettingsStore.getInstance().setKeybinding(item.id, null);
                        setAppDraft(SettingsStore.getInstance().getAppSettings());
                    }
                },
            },
        ],
    });

    if (!isActive) return null;

    const modalWidth = Math.min(90, Math.max(60, terminalWidth - 6));
    const innerWidth = modalWidth - 6;
    const listHeight = Math.max(3, terminalHeight - MODAL_OVERHEAD);

    return (
        <>
            <Box
                position="absolute"
                width="100%"
                height={terminalHeight}
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={theme.action.primary}
                    borderBackgroundColor={theme.ui.background}
                    paddingX={2}
                    paddingY={1}
                    marginX={2}
                    marginY={3}
                    width={modalWidth}
                    backgroundColor={theme.ui.background}
                    flexGrow={1}
                    flexShrink={0}
                >
                    {/* Title + tab bar */}
                    <Box justifyContent="space-between" flexShrink={0}>
                        <Text bold color={theme.action.primary}>
                            SETTINGS
                        </Text>
                        <Box flexDirection="row" flexShrink={0}>
                            <Text
                                bold={activeTab === "settings"}
                                color={activeTab === "settings" ? theme.text.active : theme.text.muted}
                            >
                                Settings
                            </Text>
                            <Text dimColor>{" │ "}</Text>
                            <Text
                                bold={activeTab === "shortcuts"}
                                color={activeTab === "shortcuts" ? theme.text.active : theme.text.muted}
                            >
                                Shortcuts
                            </Text>
                            <Text dimColor>{"  [Tab]"}</Text>
                        </Box>
                    </Box>

                    {activeTab === "settings" ? (
                        <>
                            <Box flexGrow={1} overflow="hidden">
                                <SettingsTab
                                    isActive={isActive}
                                    items={filteredItems}
                                    selectedIndex={safeSelectedIndex}
                                    editingIndex={editingIndex}
                                    editValue={editValue}
                                    searchQuery={searchQuery}
                                    searchFocused={modalFocus === "search" && !confirmExit}
                                    width={innerWidth}
                                    height={listHeight}
                                    onSearchChange={setSearchQuery}
                                    onEditChange={setEditValue}
                                    onEditSubmit={(item, v) => {
                                        if (item.kind === "textInput") item.set(v);
                                        setEditingIndex(null);
                                    }}
                                />
                            </Box>

                            {/* Settings footer */}
                            <Box marginTop={1} flexDirection="row" flexShrink={0}>
                                {modalFocus === "search" ? (
                                    <>
                                        <Hint label="Go to list" shortcut="↓/Enter" />
                                        <Hint label="Save & Exit" shortcut="Ctrl+S" />
                                        <Hint label="Discard" shortcut="Esc" />
                                    </>
                                ) : (
                                    <>
                                        <Hint label="Navigate" shortcut="↑↓" />
                                        <Hint label="Interact" shortcut="Enter" />
                                        <Hint label="Save & Exit" shortcut="Ctrl+S" />
                                        <Hint label="Discard" shortcut="Esc" />
                                    </>
                                )}
                            </Box>
                        </>
                    ) : (
                        <>
                            {/* Shortcuts tab */}
                            <Box flexGrow={1} overflow="hidden">
                                <ShortcutsTab
                                    isActive={isActive}
                                    selectedIndex={shortcutsSelectedIndex}
                                    rebindingId={rebindingId}
                                    width={innerWidth}
                                    height={listHeight}
                                    searchQuery={shortcutsSearchQuery}
                                    searchFocused={shortcutsModalFocus === "search" && !confirmExit}
                                    onSearchChange={(v) => {
                                        setShortcutsSearchQuery(v);
                                        setShortcutsSelectedIndex(0);
                                    }}
                                />
                            </Box>

                            {/* Shortcuts footer */}
                            <Box marginTop={1} flexDirection="row" flexShrink={0}>
                                {rebindingId ? (
                                    <Hint label="Cancel" shortcut="Esc" />
                                ) : shortcutsModalFocus === "search" ? (
                                    <>
                                        <Hint label="Go to list" shortcut="↓/Enter" />
                                        <Hint label="Save & Exit" shortcut="Ctrl+S" />
                                        <Hint label="Discard" shortcut="Esc" />
                                    </>
                                ) : (
                                    <>
                                        <Hint label="Navigate" shortcut="↑↓" />
                                        <Hint label="Rebind" shortcut="Enter" />
                                        <Hint label="Reset" shortcut="Del" />
                                        <Hint label="Save & Exit" shortcut="Ctrl+S" />
                                        <Hint label="Discard" shortcut="Esc" />
                                    </>
                                )}
                            </Box>
                        </>
                    )}
                </Box>
            </Box>

            {confirmExit && (
                <Box
                    position="absolute"
                    width="100%"
                    height={terminalHeight}
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box
                        flexDirection="column"
                        borderStyle="round"
                        borderColor={theme.status.warning}
                        borderBackgroundColor={theme.ui.background}
                        backgroundColor={theme.ui.background}
                        paddingX={2}
                        paddingY={1}
                        width={Math.min(60, modalWidth)}
                    >
                        <Text bold color={theme.status.warning}>
                            Unsaved changes
                        </Text>
                        <Box marginTop={1}>
                            <Text>You have unsaved changes. Save before leaving?</Text>
                        </Box>
                        <Box marginTop={1} flexDirection="row">
                            {EXIT_CHOICES.map((choice, i) => {
                                const selected = i === confirmChoice;
                                const label =
                                    choice === "save" ? "Save & Exit" : choice === "discard" ? "Discard" : "Cancel";
                                return (
                                    <Box key={choice} marginRight={2} flexShrink={0}>
                                        <Text
                                            bold={selected}
                                            color={selected ? theme.ui.background : theme.text.muted}
                                            backgroundColor={selected ? theme.action.primary : undefined}
                                        >
                                            {` ${label} `}
                                        </Text>
                                    </Box>
                                );
                            })}
                        </Box>
                        <Box marginTop={1} flexDirection="row">
                            <Hint label="Choose" shortcut="←→" />
                            <Hint label="Confirm" shortcut="Enter" />
                            <Hint label="Save" shortcut="Ctrl+S" />
                            <Hint label="Cancel" shortcut="Esc" />
                        </Box>
                    </Box>
                </Box>
            )}
        </>
    );
};
