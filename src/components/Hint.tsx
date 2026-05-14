import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../base/themeContext";

export function Hint({
  label,
  shortcut,
  dim,
}: {
  label: string;
  shortcut: string;
  dim?: boolean;
}) {
  const theme = useTheme();
  return (
    <Box marginRight={2} flexShrink={0}>
      <Text color={theme.text.active} dimColor={dim} bold>
        [{shortcut}]
      </Text>
      <Text color={theme.text.hint} dimColor={dim}>
        {" "}
        {label}
      </Text>
    </Box>
  );
}
