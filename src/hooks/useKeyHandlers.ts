import { useFocusContext } from "#contexts/FocusContext";
import { useToolbarActionsRef } from "#contexts/ToolbarActionsContext";
import { FlowBase } from "#base/flow/flow-base";
import { Task } from "#base/task/task";
import { PromptType } from "#base/task/task-prompt";
import { useActivePrompt } from "#components/PromptModal/useActivePrompt";
import { useShortcuts, ShortcutDef } from "#hooks/useShortcuts";
import { getContextualShortcutIds } from "#types/actions";
import { globalLogger } from "#base/logger/logger";

// ── Toolbar ───────────────────────────────────────────────────────────────────

export function useToolbarShortcuts(): void {
    const { focusState, moveToolbarSelection } = useFocusContext();
    const actionsRef = useToolbarActionsRef();
    const isActive = focusState.activeWindow === "toolbar";

    useShortcuts({
        id: "toolbar",
        isActive,
        priority: 150,
        shortcuts: [
            {
                id: "toolbar.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous",
                handler: () => moveToolbarSelection("left"),
            },
            {
                id: "toolbar.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next",
                handler: () => moveToolbarSelection("right"),
            },
            {
                id: "toolbar.down",
                defaultShortcut: { key: "downArrow" },
                label: "Focus tasks",
                handler: () => moveToolbarSelection("down"),
            },
            {
                id: "toolbar.enter",
                defaultShortcut: { key: "return" },
                label: "Activate",
                handler: () => actionsRef.current[focusState.toolbar.selectedButtonIndex]?.(),
            },
        ],
    });
}

// ── Task list ─────────────────────────────────────────────────────────────────

export function useTaskListShortcuts(tasks: Task[], flow: FlowBase | undefined): void {
    const { focusState, moveTaskSelection, resizePanels, toggleTaskSelection, selectAllTasks, clearSelection } =
        useFocusContext();
    const isActive = focusState.activeWindow === "taskList";

    const selectedTask = tasks[focusState.taskList.selectedTaskIndex];
    const multiCount = focusState.taskList.selectedTaskIds.size;

    // Derive contextual action shortcuts from the flow's action bar for the current task/column.
    // Computed inline (no memo) so the action bar is always fresh — task internal state (status,
    // column values) changes without changing the task object reference, which would fool useMemo.
    const contextualShortcuts: ShortcutDef[] = (() => {
        if (!flow || !selectedTask) return [];
        const bar = flow.getContextualActionBar(selectedTask, {
            columnIndex: focusState.taskList.selectedColumnIndex,
        });
        if (!bar) return [];

        const defs: ShortcutDef[] = [];
        for (const action of bar.rows.flatMap((r) => r.actions)) {
            const ids = getContextualShortcutIds(action);
            for (let i = 0; i < action.shortcuts.length; i++) {
                const shortcut = action.shortcuts[i];
                defs.push({
                    id: ids[i],
                    defaultShortcut: shortcut,
                    label: action.label,
                    handler: () => {
                        try {
                            if (multiCount > 1 && action.multiSelectAllowed && action.onClickBatch) {
                                const selected = tasks.filter((t) =>
                                    focusState.taskList.selectedTaskIds.has(t.getId())
                                );
                                action.onClickBatch(selected);
                            } else if (
                                !(multiCount > 1 && !action.multiSelectAllowed) &&
                                !(multiCount <= 1 && action.multiSelectOnly)
                            ) {
                                action.onClick();
                            }
                        } catch (err) {
                            globalLogger.error(err instanceof Error ? err.message : String(err));
                        }
                    },
                });
            }
        }
        return defs;
    })();

    useShortcuts({
        id: "taskList",
        isActive,
        priority: 150,
        shortcuts: [
            {
                id: "taskList.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => moveTaskSelection("up"),
            },
            {
                id: "taskList.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => moveTaskSelection("down"),
            },
            {
                id: "taskList.shrink",
                defaultShortcut: { key: "upArrow", shift: true },
                label: "Shrink panel",
                handler: () => resizePanels("shrink"),
            },
            {
                id: "taskList.grow",
                defaultShortcut: { key: "downArrow", shift: true },
                label: "Grow panel",
                handler: () => resizePanels("grow"),
            },
            {
                id: "taskList.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Left column",
                handler: () => moveTaskSelection("left"),
            },
            {
                id: "taskList.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Right column",
                handler: () => moveTaskSelection("right"),
            },
            {
                id: "taskList.selectAll",
                defaultShortcut: { input: "a", ctrl: true },
                label: "Select all",
                handler: () => selectAllTasks(tasks.map((t) => t.getId())),
            },
            {
                id: "taskList.clearSelection",
                defaultShortcut: { key: "escape" },
                label: "Clear selection",
                handler: () => clearSelection(),
            },
            {
                id: "taskList.multiSelect",
                defaultShortcut: { input: " " },
                label: "Multi-select",
                handler: () => {
                    const task = tasks[focusState.taskList.selectedTaskIndex];
                    if (task) toggleTaskSelection(task.getId());
                },
            },
            ...contextualShortcuts,
        ],
    });
}

// ── Task list header ──────────────────────────────────────────────────────────

export function useTaskHeaderShortcuts(
    isColumnResizable: boolean,
    columnLabel: string,
    onResize: (direction: "left" | "right") => void
): void {
    const { focusState } = useFocusContext();
    const isActive = focusState.activeWindow === "taskList" && focusState.taskList.isHeaderFocused && isColumnResizable;

    useShortcuts({
        id: "taskListHeader",
        isActive,
        priority: 160,
        shortcuts: [
            {
                id: "taskListHeader.narrowColumn",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Narrow column",
                handler: () => onResize("left"),
            },
            {
                id: "taskListHeader.widenColumn",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Widen column",
                handler: () => onResize("right"),
            },
        ],
        hintLines: [
            {
                id: "taskListHeader.resizeHints",
                left: { type: "text", value: `Column ${columnLabel}`, bold: true },
                shortcutIds: ["taskListHeader.narrowColumn", "taskListHeader.widenColumn"],
            },
        ],
    });
}

// ── Prompt ────────────────────────────────────────────────────────────────────

export function usePromptShortcuts(tasks: Task[]): void {
    const { task, prompt } = useActivePrompt(tasks);
    const { focusState } = useFocusContext();
    const isActive = focusState.activeWindow === "prompt";

    useShortcuts({
        id: "prompt",
        isActive,
        priority: 200,
        exclusive: true,
        shortcuts: [
            {
                id: "prompt.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (task && prompt) prompt.cancelPrompt(new Error("User cancelled"));
                },
            },
            {
                id: "prompt.yes",
                defaultShortcut: { input: "y" },
                label: "Yes",
                handler: () => {
                    if (!task || !prompt) return;
                    const current = prompt.getCurrentPrompt();
                    if (current?.type === PromptType.Confirm) prompt.resolvePrompt(true);
                },
            },
            {
                id: "prompt.no",
                defaultShortcut: { input: "n" },
                label: "No",
                handler: () => {
                    if (!task || !prompt) return;
                    const current = prompt.getCurrentPrompt();
                    if (current?.type === PromptType.Confirm) prompt.resolvePrompt(false);
                },
            },
        ],
    });
}

// ── Legacy KeyHandler type (kept for any remaining callers) ───────────────────

export type KeyHandler = (input: string, key: import("ink").Key) => void;
