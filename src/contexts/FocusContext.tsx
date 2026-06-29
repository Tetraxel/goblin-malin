import React, { createContext, useContext, useMemo, ReactNode } from "react";
import { useFocusManager, FocusState } from "#hooks/useFocusManager";

type FocusManager = ReturnType<typeof useFocusManager>;

/**
 * Split focus context (P19). A single context value churned on every keystroke,
 * re-rendering all ~30 consumers. We slice it so a consumer only re-renders when
 * the part it reads changes:
 *
 * - `FocusActionsContext` — the dispatch functions. Stable for the app's life;
 *   action-only consumers (toolbar buttons, etc.) never re-render.
 * - `FocusChromeContext` — the window chrome that changes on neither task scroll
 *   nor secondary-panel navigation (activeWindow, toolbar, layout, modals, …).
 *   Chrome consumers (Toolbar name/buttons, modals) skip both kinds of scroll.
 * - `FocusTaskListContext` — the task-list selection slice; changes on task scroll.
 * - `FocusSecondaryPanelContext` — the secondary-panel slice (subTab + sourcesPanel
 *   cursor/field index); changes when navigating fields/sources in that panel, so
 *   field/source navigation doesn't churn the chrome.
 * - `FocusStateContext` — the full derived state, for the back-compat
 *   `useFocusContext()` aggregator used by consumers that genuinely need to
 *   re-render on any state change.
 */

// Actions are everything the manager returns except `focusState`.
export type FocusActions = Omit<FocusManager, "focusState">;

// Chrome = full state minus the slices that change during in-panel navigation.
export type FocusChrome = Omit<FocusState, "taskList" | "secondaryPanel">;

export type FocusTaskList = FocusState["taskList"];
export type FocusSecondaryPanel = FocusState["secondaryPanel"];

const FocusActionsContext = createContext<FocusActions | null>(null);
const FocusChromeContext = createContext<FocusChrome | null>(null);
const FocusTaskListContext = createContext<FocusTaskList | null>(null);
const FocusSecondaryPanelContext = createContext<FocusSecondaryPanel | null>(null);
const FocusStateContext = createContext<FocusState | null>(null);

export const FocusProvider: React.FC<{
    children: ReactNode;
    toolbarButtonCount: number;
    taskCount: number;
    taskColumnCount: number;
}> = ({ children, ...config }) => {
    const fm = useFocusManager(config);
    const fs = fm.focusState;

    // The action functions are all stable useCallbacks; bundling them in a memo
    // keyed on each one yields an object whose identity never changes in practice.
    const actions = useMemo<FocusActions>(
        () => ({
            switchWindow: fm.switchWindow,
            switchBack: fm.switchBack,
            handleTabPress: fm.handleTabPress,
            switchMode: fm.switchMode,
            resizePanels: fm.resizePanels,
            setPrimaryMode: fm.setPrimaryMode,
            setSecondaryTab: fm.setSecondaryTab,
            moveToolbarSelection: fm.moveToolbarSelection,
            moveTaskSelection: fm.moveTaskSelection,
            toggleTaskSelection: fm.toggleTaskSelection,
            selectAllTasks: fm.selectAllTasks,
            clearSelection: fm.clearSelection,
            setCursor: fm.setCursor,
            setShowDiscoverySources: fm.setShowDiscoverySources,
            setSourcesInnerFocus: fm.setSourcesInnerFocus,
            setDetailFieldIndex: fm.setDetailFieldIndex,
            setIsEditingField: fm.setIsEditingField,
            openWizard: fm.openWizard,
            openUpdateModal: fm.openUpdateModal,
        }),
        [
            fm.switchWindow,
            fm.switchBack,
            fm.handleTabPress,
            fm.switchMode,
            fm.resizePanels,
            fm.setPrimaryMode,
            fm.setSecondaryTab,
            fm.moveToolbarSelection,
            fm.moveTaskSelection,
            fm.toggleTaskSelection,
            fm.selectAllTasks,
            fm.clearSelection,
            fm.setCursor,
            fm.setShowDiscoverySources,
            fm.setSourcesInnerFocus,
            fm.setDetailFieldIndex,
            fm.setIsEditingField,
            fm.openWizard,
            fm.openUpdateModal,
        ]
    );

    // Chrome slice — memoized on each field so it keeps a stable identity while
    // only an in-panel cursor moves (then every dep below is unchanged).
    const chrome = useMemo<FocusChrome>(
        () => ({
            activeWindow: fs.activeWindow,
            previousWindow: fs.previousWindow,
            returningFromWindow: fs.returningFromWindow,
            toolbar: fs.toolbar,
            logPanel: fs.logPanel,
            footer: fs.footer,
            layout: fs.layout,
            prompt: fs.prompt,
            modal: fs.modal,
            wizardConfig: fs.wizardConfig,
            wizardOnDisable: fs.wizardOnDisable,
            isEditingField: fs.isEditingField,
        }),
        [
            fs.activeWindow,
            fs.previousWindow,
            fs.returningFromWindow,
            fs.toolbar,
            fs.logPanel,
            fs.footer,
            fs.layout,
            fs.prompt,
            fs.modal,
            fs.wizardConfig,
            fs.wizardOnDisable,
            fs.isEditingField,
        ]
    );

    return (
        <FocusActionsContext.Provider value={actions}>
            <FocusChromeContext.Provider value={chrome}>
                <FocusSecondaryPanelContext.Provider value={fs.secondaryPanel}>
                    <FocusTaskListContext.Provider value={fs.taskList}>
                        <FocusStateContext.Provider value={fs}>{children}</FocusStateContext.Provider>
                    </FocusTaskListContext.Provider>
                </FocusSecondaryPanelContext.Provider>
            </FocusChromeContext.Provider>
        </FocusActionsContext.Provider>
    );
};

/** Stable dispatch functions. Consumers using only this never re-render on state change. */
export const useFocusActions = (): FocusActions => {
    const ctx = useContext(FocusActionsContext);
    if (!ctx) throw new Error("useFocusActions must be used within FocusProvider");
    return ctx;
};

/** Window/chrome state that does NOT change while the task cursor moves. */
export const useFocusChrome = (): FocusChrome => {
    const ctx = useContext(FocusChromeContext);
    if (!ctx) throw new Error("useFocusChrome must be used within FocusProvider");
    return ctx;
};

/** Task-list selection slice. Changes on scroll/selection. */
export const useFocusTaskList = (): FocusTaskList => {
    const ctx = useContext(FocusTaskListContext);
    if (!ctx) throw new Error("useFocusTaskList must be used within FocusProvider");
    return ctx;
};

/** Secondary-panel slice (subTab + sources cursor/field index). Changes on in-panel navigation. */
export const useFocusSecondaryPanel = (): FocusSecondaryPanel => {
    const ctx = useContext(FocusSecondaryPanelContext);
    if (!ctx) throw new Error("useFocusSecondaryPanel must be used within FocusProvider");
    return ctx;
};

/**
 * Back-compat aggregator returning `{ focusState, ...actions }`. Re-renders on
 * every state change (it reads the full state), so prefer the sliced hooks above
 * for anything that doesn't need the live task-list selection.
 */
export const useFocusContext = (): FocusManager => {
    const focusState = useContext(FocusStateContext);
    const actions = useContext(FocusActionsContext);
    if (!focusState || !actions) throw new Error("useFocusContext must be used within FocusProvider");
    return useMemo(() => ({ focusState, ...actions }), [focusState, actions]);
};
