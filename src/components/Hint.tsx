import React from "react";
import { Box, Text } from "ink";

export function Hint({
  label,
  shortcut,
  dim,
}: {
  label: string;
  shortcut: string;
  dim?: boolean;
}) {
  return (
    <Box marginRight={2}>
      <Text color="white" dimColor={dim} bold>
        [{shortcut}]
      </Text>
      <Text color="gray" dimColor={dim}>
        {" "}
        {label}
      </Text>
    </Box>
  );
}
