import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { ConfirmModalConfig } from "./useConfirmModal";
import { Hint } from "../Hint";

interface ConfirmModalProps {
    pendingConfig: ConfirmModalConfig | null;
    terminalHeight: number;
    terminalWidth: number;
    onConfirm: (index: number) => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    pendingConfig,
    terminalHeight,
    terminalWidth,
    onConfirm,
    onCancel,
}) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const [choiceIndex, setChoiceIndex] = useState(0);

    const [prevConfig, setPrevConfig] = useState(pendingConfig);
    if (prevConfig !== pendingConfig) {
        setPrevConfig(pendingConfig);
        setChoiceIndex(0);
    }

    useEffect(() => {
        if (!pendingConfig) return;
        switchWindow("confirmModal");
        return () => {
            switchBack();
        };
    }, [pendingConfig, switchWindow, switchBack]);

    const choiceCount = pendingConfig?.choices.length ?? 1;
    const isActive = pendingConfig !== null && focusState.activeWindow === "confirmModal";

    useShortcuts({
        id: "confirmModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "confirmModal.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous",
                handler: () => setChoiceIndex((c) => (c - 1 + choiceCount) % choiceCount),
            },
            {
                id: "confirmModal.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next",
                handler: () => setChoiceIndex((c) => (c + 1) % choiceCount),
            },
            {
                id: "confirmModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: () => onConfirm(choiceIndex),
            },
            {
                id: "confirmModal.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => onCancel(),
            },
        ],
    });

    if (!pendingConfig) return null;

    const modalWidth = Math.min(60, Math.max(40, terminalWidth - 10));

    return (
        <Box
            position="absolute"
            width="100%"
            height={terminalHeight}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
        >
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={pendingConfig.accentColor}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
            >
                <Text bold color={pendingConfig.accentColor}>
                    {pendingConfig.title}
                </Text>
                <Box marginTop={1}>
                    <Text>{pendingConfig.message}</Text>
                </Box>
                <Box marginTop={1} flexDirection="row">
                    {pendingConfig.choices.map((choice, i) => {
                        const selected = i === choiceIndex;
                        return (
                            <Box key={i} marginRight={2} flexShrink={0}>
                                <Text
                                    bold={selected}
                                    color={selected ? theme.ui.background : choice.color}
                                    backgroundColor={selected ? choice.color : undefined}
                                >
                                    {` ${choice.label} `}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
                <Box marginTop={1} flexDirection="row">
                    <Hint label="Choose" shortcut="←→" />
                    <Hint label="Confirm" shortcut="Enter" />
                    <Hint label="Cancel" shortcut="Esc" />
                </Box>
            </Box>
        </Box>
    );
};
