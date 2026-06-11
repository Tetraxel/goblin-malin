import React, { useCallback, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { useFocusContext } from "#contexts/FocusContext";
import { SettingsStore } from "#settings/settingsStore";
import { useTheme } from "#base/themeContext";
import { Hint } from "../Hint";
import { WithBackground } from "../WithBackground";

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

    useShortcuts({
        id: "welcomeModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "welcomeModal.close",
                defaultShortcut: { key: "escape" },
                label: "Close",
                handler: handleClose,
            },
            {
                id: "welcomeModal.toggle",
                defaultShortcut: { key: "return" },
                label: "Toggle",
                handler: () => setDontShowAgain((prev) => !prev),
            },
        ],
    });

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
                flexShrink={0}
                width={modalWidth}
                backgroundColor={theme.ui.background}
            >
                <Box flexDirection="row" flexShrink={0} backgroundColor={theme.ui.background}>
                    <Text bold color={theme.ui.modalBorder}>
                        {"Welcome to "}
                    </Text>

                    <WithBackground color={theme.ui.background}>
                        <Gradient name="rainbow">
                            <Text bold>Goblin Malin 😉</Text>
                        </Gradient>
                    </WithBackground>
                </Box>
                {/* {!hasSmallScreen && (
                    <Box overflow="hidden" flexShrink={0}>
                        <WithBackground color={theme.ui.background}>
                            <Gradient name="rainbow">
                                <BigText text="Goblin Malin" />
                            </Gradient>
                        </WithBackground>
                    </Box>
                )} */}

                <Box flexDirection="column" flexShrink={0}>
                    <Text>Paste a Spotify or YouTube link — Goblin Malin handles the rest.</Text>
                    <Text dimColor>{"Here's how it works:"}</Text>
                </Box>

                <Box flexDirection="column" marginTop={1} flexShrink={0}>
                    {STEPS.map((step, i) => (
                        <Box key={i} flexDirection="row">
                            <Text color={theme.text.muted}>{`  ${i + 1}. `}</Text>
                            <Text>{step}</Text>
                        </Box>
                    ))}
                </Box>

                <Box flexDirection="column" marginTop={1} flexShrink={0}>
                    <Text bold color={theme.text.secondary}>
                        Useful shortcuts:
                    </Text>
                    {SHORTCUTS.map(([shortcut, desc]) => (
                        <Box key={shortcut} flexDirection="row" flexShrink={0}>
                            <Box width={12} minWidth={12} flexShrink={0}>
                                <Text bold color={theme.text.active}>
                                    {`  [${shortcut}]`}
                                </Text>
                            </Box>
                            <Text dimColor>{desc}</Text>
                        </Box>
                    ))}
                </Box>

                <Box marginTop={1} flexDirection="row" alignItems="center" flexShrink={0}>
                    <Text color={dontShowAgain ? theme.text.active : theme.text.muted}>
                        {dontShowAgain ? "[x]" : "[ ]"}
                    </Text>
                    <Text dimColor>{" Don't show this again"}</Text>
                </Box>

                <Box marginTop={1} flexDirection="row" flexShrink={0}>
                    <Hint label="Toggle" shortcut="Enter" />
                    <Hint label="Close" shortcut="Esc" />
                </Box>
            </Box>
        </Box>
    );
};
