import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { useFocusContext } from "../../contexts/FocusContext";
import { SettingsStore } from "../../settings/settingsStore";
import { useTheme } from "../../base/themeContext";
import { Hint } from "../Hint";

const STEPS = [
    "Paste a track link from Spotify or YouTube",
    "Metadata is fetched from the source platform",
    "The track is searched across other platforms",
    "Download providers pick the best match and download it",
    "Review the file and choose where to save it",
];

const SHORTCUTS: [string, string][] = [
    ["TAB", "Cycle between panels"],
    ["1–9", "Jump to a tab"],
    ["CTRL+V", "Paste a track URL"],
    ["R", "Run the selected task"],
];

interface WelcomeModalProps {
    terminalHeight: number;
    terminalWidth: number;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ terminalHeight, terminalWidth }) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const isActive = focusState.activeWindow === "welcomeModal";
    const [dontShowAgain, setDontShowAgain] = useState(false);

    useEffect(() => {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (settings.general.showWelcomeTutorial) {
            switchWindow("welcomeModal");
        }
    }, [switchWindow]);

    const handleClose = useCallback(() => {
        if (dontShowAgain) {
            const store = SettingsStore.getInstance();
            const current = store.getAppSettings();
            store.writeAppSettings({
                ...current,
                general: { ...current.general, showWelcomeTutorial: false },
            });
        }
        switchBack();
    }, [dontShowAgain, switchBack]);

    useInput(
        (input, key) => {
            if (key.escape) {
                handleClose();
                return;
            }
            if (key.return) {
                setDontShowAgain((prev) => !prev);
            }
        },
        { isActive }
    );

    if (!isActive) return null;

    const modalWidth = Math.min(120, terminalWidth - 8);

    const hasSmallScreen = terminalWidth < 120;

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
                borderColor={theme.ui.modalBorder}
                borderBackgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                backgroundColor={theme.ui.background}
            >
                <Box flexDirection="row" flexShrink={0}>
                    <Text bold color={theme.ui.modalBorder}>
                        {"Welcome to "}
                    </Text>

                    {hasSmallScreen && (
                        <Text bold color={theme.action.primary}>
                            Goblin Malin 😉
                        </Text>
                    )}
                </Box>
                {!hasSmallScreen && (
                    <Box overflow="hidden">
                        <Gradient name="rainbow">
                            <BigText text="Goblin Malin" />
                        </Gradient>
                    </Box>
                )}

                <Box flexDirection="column">
                    <Text>Paste a Spotify or YouTube link — Goblin Malin handles the rest.</Text>
                    <Text dimColor>{"Here's how it works:"}</Text>
                </Box>

                <Box flexDirection="column" marginTop={1}>
                    {STEPS.map((step, i) => (
                        <Box key={i} flexDirection="row">
                            <Text color={theme.text.muted}>{`  ${i + 1}. `}</Text>
                            <Text>{step}</Text>
                        </Box>
                    ))}
                </Box>

                <Box flexDirection="column" marginTop={1}>
                    <Text bold color={theme.text.secondary}>
                        Useful shortcuts:
                    </Text>
                    {SHORTCUTS.map(([shortcut, desc]) => (
                        <Box key={shortcut} flexDirection="row">
                            <Box width={12} minWidth={12}>
                                <Text bold color={theme.text.active}>
                                    {`  [${shortcut}]`}
                                </Text>
                            </Box>
                            <Text dimColor>{desc}</Text>
                        </Box>
                    ))}
                </Box>

                <Box marginTop={1} flexDirection="row" alignItems="center">
                    <Text color={dontShowAgain ? theme.text.active : theme.text.muted}>
                        {dontShowAgain ? "[x]" : "[ ]"}
                    </Text>
                    <Text dimColor>{" Don't show this again"}</Text>
                </Box>

                <Box marginTop={1} flexDirection="row">
                    <Hint label="Toggle" shortcut="Enter" />
                    <Hint label="Close" shortcut="Esc" />
                </Box>
            </Box>
        </Box>
    );
};
