import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { ConfirmModalConfig } from "./useConfirmModal";
import { Hint } from "../Hint";
import type { FocusableWindow } from "#hooks/useFocusManager";

/** Windows rendered after `ConfirmModal` in `AppInner`, i.e. drawn on top of it. */
const DRAWN_ABOVE: ReadonlySet<FocusableWindow> = new Set(["tempCleanupModal", "updateModal"]);

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
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
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

    // This dialog is drawn above the other windows, so it must also own the keyboard. A window that takes
    // focus on its own after the dialog opened (e.g. the setup wizard a task asks for) would otherwise get the
    // keys meant for it, and the dialog could not be answered or closed. Closing it then returns focus to
    // that window. The few windows drawn above this dialog (see `AppInner`) keep their focus.
    useEffect(() => {
        if (pendingConfig && activeWindow !== "confirmModal" && !DRAWN_ABOVE.has(activeWindow)) {
            switchWindow("confirmModal");
        }
    }, [pendingConfig, activeWindow, switchWindow]);

    const choiceCount = pendingConfig?.choices.length ?? 1;
    const isActive = pendingConfig !== null && activeWindow === "confirmModal";

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
                flexShrink={0}
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
                    {/* A notice has one button: nothing to choose between, and Esc just closes it. */}
                    {choiceCount > 1 && (
                        <Hint label="Choose" shortcutIds={["confirmModal.left", "confirmModal.right"]} />
                    )}
                    <Hint label={choiceCount > 1 ? "Confirm" : "OK"} shortcutId="confirmModal.confirm" />
                    <Hint label={choiceCount > 1 ? "Cancel" : "Close"} shortcutId="confirmModal.cancel" />
                </Box>
            </Box>
        </Box>
    );
};
