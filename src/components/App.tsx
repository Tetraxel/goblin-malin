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
import { useExitButton } from "./Toolbar/useExitButton";
import { checkForUpdate, UpdateInfo } from "#updater/updateChecker";
import { SettingsStore } from "#settings/settingsStore";

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
            const buttons = [...(currentFlow.getToolbarButtons() ?? []), useSettingsButton, useExitButton];
            setToolbarButtons(buttons);
            setColumns(currentFlow.getColumns() ?? []);
        });
        return unsubscribe;
    }, [currentFlow, currentFlow?.id]);

    useEffect(() => {
        const unsubscribe = orchestrator.subscribe((orchestrator) => {
            setTasks(orchestrator.getTasks());
        });
        return unsubscribe;
    }, [orchestrator, orchestrator.id]);

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
