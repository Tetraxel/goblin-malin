import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { DeleteConfirmRequest } from "#base/flow/deleteConfirmBridge";
import { Hint } from "../Hint";

const CHOICES = ["delete", "cancel"] as const;
type Choice = (typeof CHOICES)[number];

interface DeleteConfirmModalProps {
    pendingDelete: DeleteConfirmRequest | null;
    terminalHeight: number;
    terminalWidth: number;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
    pendingDelete,
    terminalHeight,
    terminalWidth,
    onConfirm,
    onCancel,
}) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const [choiceIndex, setChoiceIndex] = useState(0);

    const [prevPending, setPrevPending] = useState(pendingDelete);
    if (prevPending !== pendingDelete) {
        setPrevPending(pendingDelete);
        setChoiceIndex(0);
    }

    useEffect(() => {
        if (!pendingDelete) return;
        switchWindow("deleteConfirmModal");
        return () => {
            switchBack();
        };
    }, [pendingDelete, switchWindow, switchBack]);

    const isActive = pendingDelete !== null && focusState.activeWindow === "deleteConfirmModal";

    useShortcuts({
        id: "deleteConfirmModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "deleteConfirmModal.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous",
                handler: () => setChoiceIndex((c) => (c - 1 + CHOICES.length) % CHOICES.length),
            },
            {
                id: "deleteConfirmModal.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next",
                handler: () => setChoiceIndex((c) => (c + 1) % CHOICES.length),
            },
            {
                id: "deleteConfirmModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: () => {
                    const choice: Choice = CHOICES[choiceIndex];
                    if (choice === "delete") {
                        onConfirm();
                    } else {
                        onCancel();
                    }
                },
            },
            {
                id: "deleteConfirmModal.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => onCancel(),
            },
        ],
    });

    if (!pendingDelete) return null;

    const count = pendingDelete.taskCount;
    const modalWidth = Math.min(60, Math.max(40, terminalWidth - 10));

    const choiceLabel = (choice: Choice): string => (choice === "delete" ? "Delete" : "Cancel");

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
                borderColor={theme.status.error}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
            >
                <Text bold color={theme.status.error}>
                    Delete {count === 1 ? "task" : "tasks"}
                </Text>
                <Box marginTop={1}>
                    <Text>
                        Remove {count} {count === 1 ? "task" : "tasks"} from the queue?
                    </Text>
                </Box>
                <Box marginTop={1} flexDirection="row">
                    {CHOICES.map((choice, i) => {
                        const selected = i === choiceIndex;
                        const color = choice === "delete" ? theme.status.error : theme.text.muted;
                        return (
                            <Box key={choice} marginRight={2} flexShrink={0}>
                                <Text
                                    bold={selected}
                                    color={selected ? theme.ui.background : color}
                                    backgroundColor={selected ? color : undefined}
                                >
                                    {` ${choiceLabel(choice)} `}
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
