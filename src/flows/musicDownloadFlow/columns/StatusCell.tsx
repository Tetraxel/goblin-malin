import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { ColumnComponent } from "../../../components/TaskListPanel";
import { StatusAttributes, StatusType } from "../../../base/task/task-status";
import { AnimatedIcon, Icon } from "../../../components/AnimatedIcon";
import { MusicDownloadTaskAttributes } from "../types";
import { useWhyDidYouUpdate } from "../../../utils/useWhyDidYouUpdate";

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
      return <Text color="gray">▪</Text>;
    case StatusType.Default:
    case StatusType.Processing:
    default:
      return <AnimatedIcon icon={Icon.Dots} />;
    // return <Spinner type="dots" />;
  }
}

function getStatusColor(status: StatusType): string {
  switch (status) {
    case StatusType.Default:
      return "blue";
    case StatusType.Processing:
      return "blue";
    case StatusType.Pending:
      return "white";
    case StatusType.PendingUserAction:
      return "yellow";
    case StatusType.Skipped:
      return "gray";
    case StatusType.Locked:
      return "whiteBright";
    case StatusType.Error:
      return "red";
    case StatusType.Success:
      return "green";
    default:
      return "gray";
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
  width,
  isSelected,
}) => {
  const statusColor = getStatusColor(task.status.type);
  const statusText = getStatusText(task.status);
  const iconComponent = getStatusIcon(task.status.type);

  useWhyDidYouUpdate("StatusCell", {
    task,
    width,
    isSelected,
  });

  return (
    <Box overflow="hidden">
      <Box marginRight={2}>{iconComponent}</Box>
      <Text color={statusColor} wrap="truncate-end" underline={isSelected}>
        {statusText}
      </Text>
    </Box>
  );
};
