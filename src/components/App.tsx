import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useScreenSize } from "#hooks/useScreenSize";
import { useSettingsVersion } from "#hooks/useSettingsVersion";
import { FocusProvider } from "#contexts/FocusContext";
import { ToolbarActionsProvider } from "#contexts/ToolbarActionsContext";
import { ThemeProvider } from "#base/themeContext";
import { ShortcutRegistryProvider } from "#base/shortcuts/ShortcutRegistry";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { Task, TaskAttributes } from "#base/task/task";
import { computeColumns, PrimaryMode } from "#flows/musicDownloadFlow/taskColumns";
import { buildVisibleTaskOrder } from "#flows/musicDownloadFlow/utils/buildVisibleTaskOrder";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { getInstance } from "#utils/mpvPlayer";
import { getAssetPath } from "#utils/appPaths";
import { AppInner } from "./AppInner";
import { TOOLBAR_BUTTONS } from "./Toolbar/toolbarButtons";
import { checkForUpdate, UpdateInfo } from "#updater/updateChecker";
import { SettingsStore } from "#settings/settingsStore";
import { SessionManager } from "#sessions/sessionManager";
import { setCacheEnabled } from "#utils/cache";

export const App: React.FC = () => {
    useEffect(() => {
        const initWav = getAssetPath("sounds", "init.wav");
        const player = getInstance();
        player
            .setVolume(50)
            .then(() => player.play(initWav))
            .catch(() => {});
    }, []);

    const [tasks, setTasks] = useState<Task<TaskAttributes>[]>([]);
    const { height: terminalHeight, width: terminalWidth } = useScreenSize();
    const orchestrator = TaskOrchestrator.getInstance();

    // The display mode is plain React state here — the single source of truth.
    // Columns derive from it (and from the current settings) with no subscription.
    const [primaryMode, setPrimaryMode] = useState<PrimaryMode>("metadata");
    const settingsVersion = useSettingsVersion();
    const columns = useMemo(
        () => computeColumns(primaryMode),
        [primaryMode, settingsVersion] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
    const isOrchestratorIdle = useCallback((orch: TaskOrchestrator) => orch.getTasksInProgress().length === 0, []);

    useEffect(() => {
        const store = SettingsStore.getInstance();
        setCacheEnabled(store.getAppSettings().general.cacheEnabled);
        return store.onSettingsChanged(() => {
            setCacheEnabled(store.getAppSettings().general.cacheEnabled);
        });
    }, []);

    useEffect(() => {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (!settings.general.checkForUpdates) return;
        checkForUpdate().then((info) => {
            if (!info?.hasUpdate) return;
            if (isOrchestratorIdle(orchestrator)) {
                setUpdateInfo(info);
            } else {
                setPendingUpdate(info);
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!pendingUpdate) return;
        return orchestrator.subscribe((orch) => {
            if (isOrchestratorIdle(orch)) {
                setUpdateInfo(pendingUpdate);
                setPendingUpdate(null);
            }
        });
    }, [pendingUpdate, orchestrator, isOrchestratorIdle]);

    // Restore the last session once at startup (gated by the reopenLastSession setting).
    useEffect(() => {
        SessionManager.getInstance().init();
    }, []);

    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((orch) => {
            const currentTasks = orch.getTasks();
            setTasks(currentTasks);
            SessionManager.getInstance().persistCurrent(currentTasks.map((t) => t.get()));
        });
        return unsubscribe;
    }, [orchestrator, orchestrator.id]);

    // Persist on per-task attribute changes (metadata fetch, downloads, edits).
    // The orchestrator only notifies on add/replace, but metadata updates notify the
    // task's own subscribers — without mirroring those, the saved session keeps the
    // empty-at-import metadata and reopening shows nothing.
    useEffect(() => {
        const manager = SessionManager.getInstance();
        const unsubscribes = tasks.map((task) =>
            task.subscribe(() => {
                manager.persistCurrent(orchestrator.getTasks().map((t) => t.get()));
            })
        );
        return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    }, [tasks, orchestrator]);

    // Collapse/expand (and other collection-only attribute changes) don't add or
    // remove tasks, so the orchestrator subscription above never fires for them —
    // bump a dedicated counter so buildVisibleTaskOrder recomputes. Scoped to
    // collection tasks only (rare, low-frequency) rather than every task, so this
    // doesn't re-render the whole tree on every metadata/download progress tick.
    const [collapseVersion, setCollapseVersion] = useState(0);
    useEffect(() => {
        const collectionTasks = tasks.filter(
            (t) => (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "collection"
        );
        const unsubscribes = collectionTasks.map((t) => t.subscribe(() => setCollapseVersion((v) => v + 1)));
        return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    }, [tasks]);

    // Grouping/collapse is purely a display-order concern — the orchestrator keeps
    // owning a flat, content-agnostic task list (see buildVisibleTaskOrder).
    const visibleTasks = useMemo(
        () => buildVisibleTaskOrder(tasks),
        [tasks, collapseVersion] // eslint-disable-line react-hooks/exhaustive-deps
    );

    return (
        <ThemeProvider>
            <ShortcutRegistryProvider>
                <FocusProvider
                    toolbarButtonCount={TOOLBAR_BUTTONS.length + (updateInfo ? 1 : 0)}
                    taskCount={visibleTasks.length}
                    taskColumnCount={columns.length}
                    primaryMode={primaryMode}
                    onPrimaryModeChange={setPrimaryMode}
                >
                    <ToolbarActionsProvider>
                        <AppInner
                            tasks={visibleTasks}
                            columns={columns}
                            terminalHeight={terminalHeight}
                            terminalWidth={terminalWidth}
                            updateInfo={updateInfo}
                        />
                    </ToolbarActionsProvider>
                </FocusProvider>
            </ShortcutRegistryProvider>
        </ThemeProvider>
    );
};
