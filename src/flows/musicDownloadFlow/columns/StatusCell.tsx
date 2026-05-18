import React from "react";
import { Box, Text } from "ink";
import { ColumnComponent } from "../../../components/TaskListPanel/TaskListPanel";
import { StatusAttributes, StatusType } from "../../../base/task/task-status";
import { AnimatedIcon, Icon } from "../../../components/AnimatedIcon";
import { MusicDownloadTaskAttributes } from "../types";
import { useTheme } from "../../../base/themeContext";
import { Theme } from "../../../base/theme";

function getStatusIcon(status: StatusType): React.ReactNode {
  switch (status) {
    case StatusType.Pending:
      return <AnimatedIcon icon={Icon.Hourglass} />;
    case StatusType.PendingUserAction:
      return <AnimatedIcon icon={Icon.Warning} />;
    case StatusType.Skipped:
      return <Text>⏭️</Text>;
    case StatusType.Locked:
      return <Text>🔒</Text>;
    case StatusType.Error:
      return <Text>❌</Text>;
    case StatusType.Success:
      return <Text>✅</Text>;
    case StatusType.NoStatus:
      return <Text>▪</Text>;
    case StatusType.Default:
    case StatusType.Processing:
    default:
      return <AnimatedIcon icon={Icon.Dots} />;
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

export const StatusCell: ColumnComponent<MusicDownloadTaskAttributes> = ({
  task,
  isSelected,
}) => {
  const theme = useTheme();
  const statusColor = getStatusColor(task.status.type, theme);
  const statusText = getStatusText(task.status);
  const iconComponent = getStatusIcon(task.status.type);

  return (
    <Box overflow="hidden">
      <Box marginRight={2}>{iconComponent}</Box>
      <Text color={statusColor} wrap="truncate-end" underline={isSelected}>
        {statusText}
      </Text>
    </Box>
  );
};
