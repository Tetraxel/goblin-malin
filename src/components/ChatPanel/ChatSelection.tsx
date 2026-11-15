import React, { useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type Task } from "#base/task/task";
import { useFocusTaskList } from "#contexts/FocusContext";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import { CHAT_AGENT_COLOR } from "./chatPanelState";

/** How long the task cursor must rest before the chip follows it (the Metadata and Download panels wait the same, and show a single key press at once). */
const SELECTION_DEBOUNCE_MS = 80;

/** A track's "Title – Artist" as the list shows it; an album or playlist is named by its kind. */
function describeTask(task: Task | undefined): string {
    const attrs = task?.getAttributes() as MusicDownloadTaskAttributes | undefined;
    if (!attrs) return "";
    if (attrs.kind === "collection") return attrs.collectionKind;
    const compiled = computeCompiledMetadata(attrs.metadataGroups ?? [], attrs.metadataOverride ?? {});
    const artist = compiled.artists[0]?.name;
    return [compiled.trackName, artist].filter(Boolean).join(" – ");
}

type Props = {
    tasks: Task[];
    /**
     * Receives what is selected right now (never the delayed value), for the header of the next message. A ref, so
     * the chat does not re-render when the cursor moves.
     */
    selectionRef: { current: string[] };
    /** Whether to draw the chip: the status line has other things to say while Claude works or a message shows. */
    show: boolean;
};

/**
 * What the user has selected in the app ("these" for Claude): the ticked tasks, or the one under the cursor. It is the
 * only part of the chat that follows the task list's cursor, so scrolling the list does not re-render the chat; and the
 * chip it draws waits for the cursor to rest, so a held ↓ does not repaint the screen once per row for it.
 */
export const ChatSelection: React.FC<Props> = ({ tasks, selectionRef, show }) => {
    const theme = useTheme();
    const taskList = useFocusTaskList();

    const live = useMemo(() => {
        if (taskList.selectedTaskIds.size > 0) return [...taskList.selectedTaskIds];
        const current = taskList.isHeaderFocused ? undefined : tasks[taskList.selectedTaskIndex];
        return current ? [current.getId()] : [];
    }, [taskList.selectedTaskIds, taskList.selectedTaskIndex, taskList.isHeaderFocused, tasks]);
    useEffect(() => {
        selectionRef.current = live;
    }, [live, selectionRef]);

    const ids = useDebouncedValue(live, SELECTION_DEBOUNCE_MS, { leading: true });
    if (!show) return null;

    if (ids.length === 0) {
        return (
            <Text color={theme.text.secondary} wrap="truncate-end">
                No task selected
            </Text>
        );
    }
    const title = ids.length === 1 ? describeTask(tasks.find((t) => t.getId() === ids[0])) : "";
    // What "these" means to Claude: a chip that cannot be missed, and the track when there is just one.
    return (
        <>
            <Box flexShrink={0}>
                <Text backgroundColor={CHAT_AGENT_COLOR} color="#000000" bold>
                    {` ● ${ids.length} task${ids.length === 1 ? "" : "s"} selected `}
                </Text>
            </Box>
            {title !== "" && (
                <Box marginLeft={2}>
                    <Text color={theme.text.primary} wrap="truncate-end">
                        {title}
                    </Text>
                </Box>
            )}
        </>
    );
};
