import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ToolbarButtonHook } from "./Toolbar/Toolbar";
import { ColumnDefinition } from "./TaskListPanel/TaskListPanel";
import { useScreenSize } from "#hooks/useScreenSize";
import { FocusProvider } from "#contexts/FocusContext";
import { ToolbarActionsProvider } from "#contexts/ToolbarActionsContext";
import { ThemeProvider } from "#base/themeContext";
import { ShortcutRegistryProvider } from "#base/shortcuts/ShortcutRegistry";
import { MusicDownloadFlow } from "#flows/musicDownloadFlow/musicDownloadFlow";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { Task, TaskAttributes } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { globalLogger } from "#base/logger/logger";
import { getInstance } from "#utils/mpvPlayer";
import { getAssetPath } from "#utils/appPaths";
import { AppInner } from "./AppInner";
import { useSettingsButton } from "./Toolbar/useSettingsButton";
import { useSessionsButton } from "./Toolbar/useSessionsButton";
import { useExitButton } from "./Toolbar/useExitButton";
import { checkForUpdate, UpdateInfo } from "#updater/updateChecker";
import { SettingsStore } from "#settings/settingsStore";
import { SessionManager } from "#sessions/sessionManager";

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
    const orchestrator = FlowOrchestrator.getInstance();
    const [activeFlowId, setActiveFlowId] = useState<string | undefined>(() => {
        orchestrator.registerFlow(MusicDownloadFlow, true);
        return orchestrator.getEnabledFlows()?.[0].id;
    });
    const [toolbarButtons, setToolbarButtons] = useState<ToolbarButtonHook[]>([]);
    const [columns, setColumns] = useState<ColumnDefinition<MusicDownloadTaskAttributes>[]>([]);
    const currentFlow = activeFlowId ? orchestrator.getFlow(activeFlowId) : undefined;

    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
    const isOrchestratorIdle = useCallback((orch: FlowOrchestrator) => orch.getTasksInProgress().length === 0, []);

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

    // [!] This is important to allow dynamic updates of buttons and columns when the flow changes
    useEffect(() => {
        if (!currentFlow) return;
        globalLogger.debug(`Active flow changed: ${currentFlow?.displayName}`);
        // Subscribe to currentFlow changes to update buttons and columns dynamically
        const unsubscribe = currentFlow.subscribe((_updatedFlow) => {
            const buttons = [
                ...(currentFlow.getToolbarButtons() ?? []),
                useSessionsButton,
                useSettingsButton,
                useExitButton,
            ];
            setToolbarButtons(buttons);
            setColumns(currentFlow.getColumns() ?? []);
        });
        return unsubscribe;
    }, [currentFlow, currentFlow?.id]);

    // Init SessionManager once the active flow is ready
    useEffect(() => {
        if (!currentFlow) return;
        SessionManager.getInstance().init(currentFlow, orchestrator);
    }, [currentFlow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((orch) => {
            const currentFlowTasks = orch.getTasks();
            setTasks(currentFlowTasks);
            SessionManager.getInstance().persistCurrent(currentFlowTasks.map((t) => t.get()));
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

    const filteredTasks = useMemo(
        () => tasks.filter((task) => task.getFlowId() === activeFlowId),
        [tasks, activeFlowId]
    );

    return (
        <ThemeProvider>
            <ShortcutRegistryProvider>
                <FocusProvider
                    toolbarButtonCount={toolbarButtons.length + (updateInfo ? 1 : 0)}
                    taskCount={filteredTasks.length}
                    taskColumnCount={columns.length}
                >
                    <ToolbarActionsProvider>
                        <AppInner
                            tasks={tasks}
                            filteredTasks={filteredTasks}
                            toolbarButtons={toolbarButtons}
                            columns={columns}
                            currentFlow={currentFlow}
                            orchestrator={orchestrator}
                            setActiveFlowId={setActiveFlowId}
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
