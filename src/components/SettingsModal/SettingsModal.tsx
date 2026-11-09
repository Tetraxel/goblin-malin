import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { ClickArea } from "#base/mouse/ClickArea";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useShortcuts } from "#hooks/useShortcuts";
import { useTheme } from "#base/themeContext";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { SettingsStore } from "#settings/settingsStore";
import { type AppSettings } from "#settings/appSettings";
import { buildGlobalSettingsItems } from "#settings/buildGlobalSettingsItems";
import { filterSettingsItems, isInteractive, type SettingsItem } from "#settings/buildSettingsItems";
import { getMusicSettings, saveMusicSettings } from "#flows/musicDownloadFlow/settings";
import { buildMusicSettingsItems } from "#flows/musicDownloadFlow/buildFlowSettingsItems";
import { describeTempUsage, getTempUsage, type TempUsage } from "#flows/musicDownloadFlow/tempCleanupFlow";
import { deepMerge } from "#utils/deepMerge";
import { type DeepPartial } from "#utils/types";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { ShortcutsTab, buildShortcutsTabItems, buildShortcutFromKey } from "./ShortcutsTab";
import { SettingsTab } from "./SettingsTab";
import { Hint } from "../Hint";
import { type ConfirmModalConfig } from "../ConfirmModal/useConfirmModal";

// Rows consumed by modal chrome: marginY(6) + borders(2) + paddingY(2) + title(1) + marginTop(1) + marginTop(1) + footer(1) = 14
// Search bars live inside each tab component and subtract their own SEARCH_H from the height budget.
const MODAL_OVERHEAD = 10;

type ActiveTab = "settings" | "shortcuts";

interface SettingsModalProps {
    terminalHeight: number;
    terminalWidth: number;
    openConfirmModal: (config: ConfirmModalConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ terminalHeight, terminalWidth, openConfirmModal }) => {
    const theme = useTheme();
    const { switchBack, openWizard } = useFocusActions();
    const { activeWindow, previousWindow, returningFromWindow } = useFocusChrome();
    const isActive = activeWindow === "settingsModal";
    const isVisible = isActive || previousWindow === "settingsModal";

    const [appDraft, setAppDraft] = useState<AppSettings>(() => SettingsStore.getInstance().getAppSettings());
    const [flowPatch, setFlowPatch] = useState<Record<string, unknown>>({});
    // How much the temporary folder holds. Measured in the background once the modal is open (it can be
    // hundreds of files): the rest of the page works meanwhile and the row says "calculating…".
    const [tempUsage, setTempUsage] = useState<TempUsage | undefined>(undefined);
    const [originalKeybindings, setOriginalKeybindings] = useState<AppSettings["keybindings"]>(
        () => SettingsStore.getInstance().getAppSettings().keybindings
    );
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

    // Reset to fresh settings when the modal becomes visible. Stays visible (isVisible=true)
    // while sub-modals like confirmModal or setupWizardModal are open, so those transitions
    // never trigger a reset.
    const [prevIsVisible, setPrevIsVisible] = useState(isVisible);
    if (prevIsVisible !== isVisible) {
        setPrevIsVisible(isVisible);
        if (isVisible) {
            const freshSettings = SettingsStore.getInstance().getAppSettings();
            setAppDraft(freshSettings);
            setOriginalKeybindings(freshSettings.keybindings);
            setFlowPatch({});
            setTempUsage(undefined);
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
            shortcutRegistry.disableRebind();
        }
    }

    // The folder as it currently stands on screen, saved or not.
    const draftTempDir = useMemo(() => {
        const merged = deepMerge(
            getMusicSettings() as unknown as Record<string, unknown>,
            flowPatch
        ) as unknown as ReturnType<typeof getMusicSettings>;
        return merged.download.outputTemporaryDir;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flowPatch, returningFromWindow]);

    // Measure when the modal opens, when the folder is edited and after a clean-up dialog closes.
    useEffect(() => {
        if (!isVisible) return;
        let cancelled = false;
        void getTempUsage(draftTempDir).then((usage) => {
            if (!cancelled) setTempUsage(usage);
        });
        return () => {
            cancelled = true;
        };
    }, [isVisible, draftTempDir, returningFromWindow]);

    const allItems = useMemo((): SettingsItem[] => {
        const globalItems = buildGlobalSettingsItems(appDraft, (patch) =>
            setAppDraft((prev) => deepMerge(prev, patch as DeepPartial<AppSettings>))
        );
        const fullMusicSettings = deepMerge(getMusicSettings() as unknown as Record<string, unknown>, flowPatch);
        const musicItems = buildMusicSettingsItems(
            fullMusicSettings,
            (patch) => setFlowPatch((prev) => deepMerge(prev, patch) as Record<string, unknown>),
            openWizard,
            { tempUsageText: describeTempUsage(tempUsage) }
        );
        return [...globalItems, ...musicItems];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appDraft, flowPatch, returningFromWindow, tempUsage]);

    const filteredItems = useMemo(() => filterSettingsItems(allItems, searchQuery), [allItems, searchQuery]);
    const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

    const isDirty = useMemo(() => {
        const saved = SettingsStore.getInstance().getAppSettings();
        if (JSON.stringify(saved.general) !== JSON.stringify(appDraft.general)) return true;
        if (Object.keys(flowPatch).length > 0) return true;
        // appDraft.keybindings is kept in sync with the store after each rebind,
        // so comparing it to the snapshot taken at modal-open detects shortcut changes.
        if (JSON.stringify(appDraft.keybindings) !== JSON.stringify(originalKeybindings)) return true;
        return false;
    }, [appDraft, flowPatch, originalKeybindings]);

    function commitAndExit() {
        SettingsStore.getInstance().writeAppSettings(appDraft);
        if (Object.keys(flowPatch).length > 0) {
            saveMusicSettings(deepMerge(getMusicSettings() as unknown as Record<string, unknown>, flowPatch));
        }
        switchBack();
    }

    /** Exit, prompting to save/discard first if there are unsaved changes. */
    function requestExit() {
        if (isDirty) {
            openConfirmModal({
                title: "Unsaved changes",
                message: "You have unsaved changes. Save before leaving?",
                choices: [
                    { label: "Save & Exit", color: theme.action.primary },
                    { label: "Discard", color: theme.action.primary },
                    { label: "Cancel", color: theme.action.primary },
                ],
                accentColor: theme.status.warning,
                onConfirm: (i) => {
                    if (i === 0) {
                        commitAndExit();
                    } else if (i === 1) {
                        // Restore all keybindings to the snapshot from modal-open in one write.
                        const current = SettingsStore.getInstance().getAppSettings();
                        SettingsStore.getInstance().writeAppSettings({
                            ...current,
                            keybindings: { ...originalKeybindings },
                        });
                        switchBack();
                    }
                    // i === 2: do nothing, stay in settings
                },
            });
            return;
        }
        switchBack();
    }

    function switchTabTo(tab: ActiveTab) {
        if (rebindingId || editingIndex !== null) return;
        setActiveTab(tab);
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

    /** Left-click on a settings row: select it and act on it like Enter would (a select steps with ◀/▶). */
    function clickSettingsItem(index: number, step?: 1 | -1) {
        if (rebindingId || editingIndex === index) return;
        const item = filteredItems[index];
        if (!item || !isInteractive(item)) return;
        setEditingIndex(null);
        setSelectedIndex(index);
        setModalFocus("list");
        if (item.kind === "checkbox") item.set(!item.get());
        else if (item.kind === "textInput") {
            setEditValue(item.get());
            setEditingIndex(index);
        } else if (item.kind === "action") item.run();
        else if (item.kind === "select") {
            const curr = item.options.indexOf(item.get());
            const n = item.options.length;
            item.set(item.options[(curr + (step ?? 1) + n) % n]);
        }
    }

    /** Left-click on a shortcut row: select it; clicking the selected row starts the rebind. */
    function clickShortcutRow(id: string) {
        if (rebindingId) return;
        const index = buildShortcutsTabItems(shortcutsSearchQuery).findIndex((it) => it.id === id);
        if (index < 0) return;
        const alreadySelected = shortcutsModalFocus === "list" && index === shortcutsSelectedIndex;
        setShortcutsModalFocus("list");
        setShortcutsSelectedIndex(index);
        if (alreadySelected) startRebind(id);
    }
    // The shortcut rows are memoized, so they get one stable callback that reads the latest closure.
    const shortcutRowClickRef = useRef(clickShortcutRow);
    useEffect(() => {
        shortcutRowClickRef.current = clickShortcutRow;
    });
    const onShortcutRowClick = useCallback((id: string) => shortcutRowClickRef.current(id), []);

    /** Mouse wheel moves the selection like ↑/↓ (the lists scroll to follow it). */
    function wheelList(delta: number) {
        if (rebindingId || editingIndex !== null) return;
        if (activeTab === "shortcuts") {
            const count = buildShortcutsTabItems(shortcutsSearchQuery).length;
            if (count === 0) return;
            if (shortcutsModalFocus === "search") {
                if (delta < 0) return;
                setShortcutsModalFocus("list");
                setShortcutsSelectedIndex(0);
                return;
            }
            setShortcutsSelectedIndex((prev) => Math.max(0, Math.min(count - 1, prev + delta)));
            return;
        }
        if (modalFocus === "search") {
            if (delta < 0) return;
            const first = filteredItems.findIndex(isInteractive);
            if (first < 0) return;
            setSelectedIndex(first);
            setModalFocus("list");
            return;
        }
        let next = safeSelectedIndex + delta;
        while (next >= 0 && next < filteredItems.length && !isInteractive(filteredItems[next])) next += delta;
        if (next >= 0 && next < filteredItems.length) setSelectedIndex(next);
    }
    const modalRef = useRef<DOMElement>(null);
    useWheelTarget(modalRef, wheelList, { window: "settingsModal" });

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
                    if (rebindingId || editingIndex !== null) return;
                    setActiveTab((t) => (t === "settings" ? "shortcuts" : "settings"));
                },
            },
            {
                id: "settingsModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (rebindingId) return;
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
                    if (rebindingId) return;
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
                    if (activeTab !== "shortcuts" || rebindingId) return;
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

    if (!isVisible) return null;

    const modalWidth = Math.min(90, Math.max(60, terminalWidth - 6));
    const innerWidth = modalWidth - 6;
    const listHeight = Math.max(3, terminalHeight - MODAL_OVERHEAD);

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
            paddingTop={4}
        >
            <Box
                ref={modalRef}
                flexDirection="column"
                borderStyle="round"
                borderColor={theme.action.primary}
                borderBackgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                marginBottom={6}
                width={modalWidth}
                backgroundColor={theme.ui.background}
                // flexGrow={1}
                flexShrink={0}
            >
                {/* Title + tab bar */}
                <Box justifyContent="space-between" flexShrink={0}>
                    <Text bold color={theme.action.primary}>
                        SETTINGS
                    </Text>
                    <Box flexDirection="row" flexShrink={0}>
                        <ClickArea window="settingsModal" onClick={() => switchTabTo("settings")} flexShrink={0}>
                            <Text
                                bold={activeTab === "settings"}
                                color={activeTab === "settings" ? theme.text.active : theme.text.muted}
                            >
                                Settings
                            </Text>
                        </ClickArea>
                        <Text dimColor>{" │ "}</Text>
                        <ClickArea window="settingsModal" onClick={() => switchTabTo("shortcuts")} flexShrink={0}>
                            <Text
                                bold={activeTab === "shortcuts"}
                                color={activeTab === "shortcuts" ? theme.text.active : theme.text.muted}
                            >
                                Shortcuts
                            </Text>
                        </ClickArea>
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
                                searchFocused={modalFocus === "search"}
                                width={innerWidth}
                                height={listHeight}
                                onSearchChange={setSearchQuery}
                                onEditChange={setEditValue}
                                onEditSubmit={(item, v) => {
                                    if (item.kind === "textInput") item.set(v);
                                    setEditingIndex(null);
                                }}
                                onSearchClick={() => {
                                    if (editingIndex === null) setModalFocus("search");
                                }}
                                onItemClick={clickSettingsItem}
                            />
                        </Box>

                        {/* Settings footer */}
                        <Box marginTop={1} flexDirection="row" flexShrink={0}>
                            {modalFocus === "search" ? (
                                <>
                                    <Hint
                                        label="Go to list"
                                        shortcutIds={["settingsModal.down", "settingsModal.enter"]}
                                    />
                                    <Hint label="Save & Exit" shortcutId="settingsModal.save" />
                                    <Hint label="Discard" shortcutId="settingsModal.escape" />
                                </>
                            ) : (
                                <>
                                    <Hint label="Navigate" shortcutIds={["settingsModal.up", "settingsModal.down"]} />
                                    <Hint label="Interact" shortcutId="settingsModal.enter" />
                                    <Hint label="Save & Exit" shortcutId="settingsModal.save" />
                                    <Hint label="Discard" shortcutId="settingsModal.escape" />
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
                                searchFocused={shortcutsModalFocus === "search"}
                                onSearchChange={(v) => {
                                    setShortcutsSearchQuery(v);
                                    setShortcutsSelectedIndex(0);
                                }}
                                onSearchClick={() => {
                                    if (!rebindingId) setShortcutsModalFocus("search");
                                }}
                                onRowClick={onShortcutRowClick}
                            />
                        </Box>

                        {/* Shortcuts footer */}
                        <Box marginTop={1} flexDirection="row" flexShrink={0}>
                            {rebindingId ? (
                                // Esc here is the intrinsic rebind-capture cancel, not a registry shortcut.
                                <Hint label="Cancel" shortcut="Esc" />
                            ) : shortcutsModalFocus === "search" ? (
                                <>
                                    <Hint
                                        label="Go to list"
                                        shortcutIds={["settingsModal.down", "settingsModal.enter"]}
                                    />
                                    <Hint label="Save & Exit" shortcutId="settingsModal.save" />
                                    <Hint label="Discard" shortcutId="settingsModal.escape" />
                                </>
                            ) : (
                                <>
                                    <Hint label="Navigate" shortcutIds={["settingsModal.up", "settingsModal.down"]} />
                                    <Hint label="Rebind" shortcutId="settingsModal.enter" />
                                    <Hint label="Reset" shortcutId="settingsModal.resetBinding" />
                                    <Hint label="Save & Exit" shortcutId="settingsModal.save" />
                                    <Hint label="Discard" shortcutId="settingsModal.escape" />
                                </>
                            )}
                        </Box>
                    </>
                )}
            </Box>
        </Box>
    );
};
