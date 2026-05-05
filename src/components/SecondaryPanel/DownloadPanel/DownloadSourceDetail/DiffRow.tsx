import React from "react";
import { Box, Text } from "ink";

const LABEL_W = 11;

export function DiffRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string;
  right: string;
}) {
  const changed = left !== right;
  return (
    <Box flexDirection="row" paddingX={1} height={1} overflow="hidden">
      <Box width={LABEL_W} minWidth={LABEL_W} flexShrink={0}>
        <Text color="cyan" bold wrap="truncate-end">
          {label.toUpperCase().padEnd(LABEL_W)}
        </Text>
      </Box>
      <Box flexGrow={1} overflow="hidden">
        <Text
          color={changed ? "gray" : "white"}
          dimColor={!changed}
          wrap="truncate-end"
        >
          {left}
        </Text>
      </Box>
      <Box width={1} minWidth={1} flexShrink={0}>
        <Text color="gray">│</Text>
      </Box>
      <Box flexGrow={1} overflow="hidden" paddingLeft={1}>
        <Text color={changed ? "yellow" : "white"} wrap="truncate-end">
          {right}
        </Text>
      </Box>
      {changed && (
        <Box width={2} minWidth={2} flexShrink={0}>
          <Text color="yellow"> ←</Text>
        </Box>
      )}
    </Box>
  );
}
