import React from "react";
import { Box, Text } from "ink";
import { Theme } from "#base/theme";
import { useTheme } from "#base/themeContext";
import { StatusAttributes, StatusType } from "#base/task/task-status";
import { ColumnComponentProps } from "#components/TaskListPanel/TaskListPanel";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useGlobalTicker } from "#hooks/useGlobalTicker";
import { formatRelativeTime } from "#utils/string";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

function getStatusIcon(status: StatusType): React.ReactNode | null {
    switch (status) {
        case StatusType.Pending:
            return <AnimatedIcon icon={Icon.Hourglass} />;
        case StatusType.PendingUserAction:
            return <AnimatedIcon icon={Icon.Warning} />;
        case StatusType.Skipped:
            return <Text>⏭️ </Text>;
        case StatusType.Locked:
            return <Text>🔒 </Text>;
        case StatusType.Error:
            return <Text>❌ </Text>;
        case StatusType.Success:
            return <Text>✅ </Text>;
        case StatusType.NoStatus:
            return null;
        case StatusType.Default:
        case StatusType.Processing:
        default:
            return <AnimatedIcon icon={Icon.Dots} interval={200} />;
    }
}

function getStatusColor(status: StatusType, theme: Theme): string {
    switch (status) {
        case StatusType.Default:
        case StatusType.Processing:
            return theme.status.processing;
        case StatusType.Pending:
            return theme.status.pending;
        case StatusType.PendingUserAction:
            return theme.status.warning;
        case StatusType.Skipped:
            return theme.status.skipped;
        case StatusType.Locked:
            return theme.status.locked;
        case StatusType.Error:
            return theme.status.error;
        case StatusType.Success:
            return theme.status.success;
        default:
            return theme.text.secondary;
    }
}

const getStatusText = (status: StatusAttributes): string => {
    let statusMessage = status.message ?? "N/A";
    if (status.timeTracking && status.startTime) {
        const elapsedMs = new Date().getTime() - status.startTime.getTime();
        const elapsedSec = Math.floor(elapsedMs / 1000);
        const minutes = Math.floor(elapsedSec / 60);
        const seconds = elapsedSec % 60;
        const elapsedStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        statusMessage = `${statusMessage} (${elapsedStr})`;
    }

    return statusMessage;
};

export const StatusCell = React.memo(function StatusCell({
    task,
    isSelected,
}: ColumnComponentProps<MusicDownloadTaskAttributes>) {
    const theme = useTheme();
    const attrs = task.attributes;
    const liveFetchedAt =
        attrs?.kind === "collection" && attrs.collectionKind === "playlist" && task.status.type === StatusType.Success
            ? attrs.live?.lastFetchedAt
            : undefined;
    // Rows with a live clock tick once a second: a finished live playlist ("Fetched Xs ago")
    // or a status with time tracking ("Discovering via Songlink (3s)"). The text is computed
    // at render time and this memoized cell otherwise only re-renders when the task changes,
    // so without the tick the clock freezes. Cost is bounded to visible rows. The returned
    // frame count isn't read; subscribing is what forces the re-render.
    const isTimed = task.status.timeTracking === true && !!task.status.startTime;
    useGlobalTicker(1000, liveFetchedAt !== undefined || isTimed);

    const statusColor = getStatusColor(task.status.type, theme);
    const iconComponent =
        task.status.icon === "agent" ? (
            <AnimatedIcon icon={Icon.Agent} interval={160} color={task.status.iconColor} />
        ) : (
            getStatusIcon(task.status.type)
        );
    const statusText = liveFetchedAt
        ? `Fetched ${formatRelativeTime(Date.now() - liveFetchedAt.getTime())}`
        : getStatusText(task.status);

    return (
        <Box flexGrow={1}>
            {iconComponent && (
                <Box paddingRight={1} flexShrink={0}>
                    {iconComponent}
                </Box>
            )}
            <Text color={statusColor} wrap="truncate-end" underline={isSelected}>
                {statusText}
            </Text>
        </Box>
    );
});
