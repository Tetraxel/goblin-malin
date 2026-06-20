import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { StartOptionsRequest } from "#types/actions";
import { Hint } from "../Hint";

interface StartModalProps {
    pendingStart: StartOptionsRequest | null;
    terminalHeight: number;
    terminalWidth: number;
    onConfirm: (opts: { toTag: boolean; toDownload: boolean }) => void;
    onCancel: () => void;
}

type StartOption = {
    label: string;
    toTag: boolean;
    toDownload: boolean;
};

const OPTIONS: StartOption[] = [
    { label: "Fetch Metadata & Download", toTag: true, toDownload: true },
    { label: "Fetch Metadata", toTag: true, toDownload: false },
];

export const StartModal: React.FC<StartModalProps> = ({
    pendingStart,
    terminalHeight,
    terminalWidth,
    onConfirm,
    onCancel,
}) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [prevPendingStart, setPrevPendingStart] = useState(pendingStart);
    if (prevPendingStart !== pendingStart) {
        setPrevPendingStart(pendingStart);
        setSelectedIndex(0);
    }

    // Take focus while the modal is rendered; restore on unmount
    useEffect(() => {
        if (!pendingStart) return;
        switchWindow("startModal");
        return () => {
            switchBack();
        };
    }, [pendingStart, switchBack, switchWindow]);

    const isActive = pendingStart !== null && focusState.activeWindow === "startModal";

    useShortcuts({
        id: "startModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "startModal.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (pendingStart) onCancel();
                },
            },
            {
                id: "startModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: () => {
                    if (!pendingStart) return;
                    const opt = OPTIONS[selectedIndex];
                    if (opt) onConfirm({ toTag: opt.toTag, toDownload: opt.toDownload });
                },
            },
            {
                id: "startModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setSelectedIndex((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length),
            },
            {
                id: "startModal.upTab",
                defaultShortcut: { key: "tab", shift: true },
                label: "Up",
                handler: () => setSelectedIndex((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length),
            },
            {
                id: "startModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setSelectedIndex((prev) => (prev + 1) % OPTIONS.length),
            },
            {
                id: "startModal.downTab",
                defaultShortcut: { key: "tab" },
                label: "Down",
                handler: () => setSelectedIndex((prev) => (prev + 1) % OPTIONS.length),
            },
        ],
    });

    if (!pendingStart) return null;

    const modalWidth = Math.min(80, Math.max(40, terminalWidth - 10));
    const count = pendingStart.taskCount;
    const title = `Start ${count} task${count === 1 ? "" : "s"}`;

    return (
        <Box position="absolute" width="100%" height={terminalHeight} flexDirection="column" paddingTop={3}>
            <Box width="100%" justifyContent="center">
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={theme.ui.modalBorder}
                    borderBackgroundColor={theme.ui.background}
                    paddingX={2}
                    paddingY={1}
                    width={modalWidth}
                    backgroundColor={theme.ui.background}
                >
                    <Text bold color={theme.ui.modalBorder}>
                        {title}
                    </Text>

                    <Box marginTop={1} flexDirection="column">
                        {OPTIONS.map((opt, idx) => {
                            const isSelected = idx === selectedIndex;
                            return (
                                <Box key={idx}>
                                    <Text bold={isSelected} color={isSelected ? theme.ui.focusIndicator : undefined}>
                                        {isSelected ? "☛ " : "  "}
                                        {opt.label}
                                    </Text>
                                </Box>
                            );
                        })}
                    </Box>

                    <Box marginTop={1} flexDirection="row">
                        <Hint label="Confirm" shortcutId="startModal.confirm" />
                        <Hint label="Select" shortcutIds={["startModal.up", "startModal.down"]} />
                        <Hint label="Cancel" shortcutId="startModal.cancel" />
                    </Box>
                </Box>
            </Box>

            <Box flexGrow={1} />
        </Box>
    );
};
