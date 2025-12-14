import React from "react";
import { Box, Text } from "ink";
import { useFocusContext } from "../contexts/FocusContext";

export const Footer: React.FC = () => {
  const { focusState, ...focusManager } = useFocusContext();
  const isActive = focusState.activeWindow === "footer";
  const height = focusState.footer.height;

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      borderTop={false}
      overflow="hidden"
      height={height}
    >
      <Text color="gray">
        Shift + ↑/↓ = Resize panels • Ctrl + C = Interrupt
      </Text>
    </Box>
  );
};
