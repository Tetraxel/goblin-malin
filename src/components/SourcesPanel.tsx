import React from "react";
import { Box, Text } from "ink";
import { Task } from "../base/task/task";

interface SourcesPanelProps {
  mode: "metadata" | "download";
  selectedTask: Task | null;
  width: number;
  height: number;
}

export const SourcesPanel: React.FC<SourcesPanelProps> = ({
  mode,
  selectedTask,
  width,
  height,
}) => {
  const leftWidth = Math.floor(width * 0.4);
  const rightWidth = width - leftWidth - 3; // -1 divider, -2 gray box L+R borders

  const placeholder =
    mode === "metadata"
      ? "Metadata Sources panel — not yet implemented (P4)"
      : "Download Sources panel — not yet implemented (P5)";

  const title = mode === "metadata" ? "Metadata" : "Download";
  const innerDashes = rightWidth - title.length - 4; // ┌ + space + title + space + ┐
  const leftDashes = Math.floor(innerDashes / 2);
  const rightDashes = innerDashes - leftDashes;
  const topBorder = `┌${"─".repeat(leftDashes)} ${title} ${"─".repeat(rightDashes)}┐`;

  return (
    <Box
      flexDirection="row"
      height={height}
      overflow="hidden"
      borderStyle="single"
      borderColor="cyan"
      borderTop={false}
      borderBottom={false}
    >
      {/* Source list (left) */}
      <Box
        flexDirection="column"
        width={leftWidth}
        height={height}
        overflow="hidden"
        borderStyle="single"
        borderColor="cyan"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Box paddingX={1}>
          <Text color="gray" italic>
            {placeholder}
          </Text>
        </Box>
      </Box>

      {/* Source detail (right) */}
      <Box
        flexDirection="column"
        width={rightWidth}
        height={height}
        overflow="hidden"
      >
        <Text color="gray">{topBorder}</Text>
        <Box
          flexDirection="column"
          height={height - 1}
          overflow="hidden"
          borderStyle="single"
          borderColor="gray"
          borderTop={false}
        >
          <Box paddingX={1}>
            <Text color="gray" italic>
              {selectedTask
                ? `Task: ${selectedTask.getId()}`
                : "No task selected"}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
