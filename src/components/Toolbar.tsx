import React from "react";
import { Box, Text, useInput } from "ink";
import stringWidth from "string-width";
import { useFocusContext } from "../contexts/FocusContext";
import { Separator } from "./Separator";

export type ToolbarButton = {
  label: string;
  icon: string;
  color: React.ComponentProps<typeof Text>["color"];
  bold?: boolean;
  hook: ({ isSelected }: { isSelected: boolean }) => { enabled?: boolean };
};

export const Toolbar = ({
  buttons,
  width,
}: {
  buttons: ToolbarButton[];
  width: number;
}) => {
  const { focusState, ...focusManager } = useFocusContext();
  const isActive = focusState.activeWindow === "toolbar";
  const height = focusState.toolbar.height;

  useInput(
    (input, key) => {
      if (key.leftArrow) focusManager.moveToolbarSelection("left");
      if (key.rightArrow) focusManager.moveToolbarSelection("right");
      if (key.downArrow) focusManager.moveToolbarSelection("down");
    },
    { isActive }
  );

  const name = "😈 Goblin Malin";
  const nameWidth = stringWidth(name);
  const splitPositions = [nameWidth + 3]; // left border + padding

  return (
    <>
      <Separator width={width} type="top" splitPositions={splitPositions} />
      <Box
        borderStyle="single"
        borderColor="cyan"
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        overflow="hidden"
        display={"flex"}
        height={height}
      >
        <Box
          borderStyle="single"
          borderColor="cyan"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          marginRight={1}
          width={nameWidth + 2}
          height={height}
          overflow="hidden"
        >
          <Text color={"yellow"} bold={true}>
            {name}
          </Text>
        </Box>

        {buttons.map((button, index) => {
          const isSelected =
            isActive && focusState.toolbar.selectedButtonIndex === index;
          const { enabled } = button.hook({ isSelected });

          if (!enabled) return null;

          return (
            <Box key={index} marginRight={0}>
              <Text
                backgroundColor={isSelected ? button.color : undefined}
                color={isSelected ? "white" : button.color}
                bold={button.bold}
              >
                {` ${button.icon} ${button.label} `}
              </Text>
            </Box>
          );
        })}

        <Box
          flexDirection={"row"}
          display={"flex"}
          flexGrow={1}
          justifyContent="flex-end"
          gap={1}
          height={height}
        >
          <Text color={"gray"} italic={true}>
            Music Download Flow
          </Text>
        </Box>
      </Box>
      <Separator
        width={width}
        splitPositions={splitPositions}
        splitCharacter={"┴"}
      />
    </>
  );
};
