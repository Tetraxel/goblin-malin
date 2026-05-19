import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../../../base/themeContext";

const LABEL_W = 11;

export function DetailRow({
  label,
  value,
  valueColor,
  dim,
}: {
  label: string;
  value: string;
  valueColor?: string;
  dim?: boolean;
}) {
  const theme = useTheme();
  return (
    <Box flexDirection="row" paddingX={1} height={1} flexShrink={0}>
      <Box width={LABEL_W} minWidth={LABEL_W} flexShrink={0} marginRight={1}>
        <Text color={theme.ui.border} bold wrap="truncate-end">
          {label.toUpperCase().padEnd(LABEL_W)}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text
          color={valueColor ?? theme.text.primary}
          dimColor={dim || value === "—"}
          wrap="truncate-end"
        >
          {value}
        </Text>
      </Box>
    </Box>
  );
}
