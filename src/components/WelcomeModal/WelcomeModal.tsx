import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { SettingsStore } from "#settings/settingsStore";
import { useTheme } from "#base/themeContext";
import { Hint } from "../Hint";
import { TOOLBAR_LOGO_CELL } from "../Toolbar/Toolbar";
import { IntroOutro, renderIntroCanvas, T } from "./intro/introScene";
import { toRGB } from "./intro/ui";

// The intro needs fluid motion, so it runs its own ~30fps clock instead of the shared
// 125ms useGlobalTicker (which is tuned for spinners). It only ticks while visible.
const FRAME_MS = 33;
// Pose shown when animations are disabled: the face fully revealed, eyes open.
const STATIC_TIME = T.IDLE + 2;
// Closing: the content fades out while the mascot shrinks onto the toolbar's 😉.
const OUTRO_S = 1.2;
const FOOTER_ROWS = 2;

const BLACK = "#000000";

interface WelcomeModalProps {
    terminalHeight: number;
    terminalWidth: number;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ terminalHeight, terminalWidth }) => {
    const theme = useTheme();
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const isActive = activeWindow === "welcomeModal";
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const [time, setTime] = useState(0);
    // Intro time at which closing started, or null while the intro plays.
    const [closingAt, setClosingAt] = useState<number | null>(null);

    useEffect(() => {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (settings.general.showWelcomeTutorial) {
            switchWindow("welcomeModal");
        }
    }, [switchWindow]);

    const animationsEnabled = SettingsStore.getInstance().getAppSettings().general.animationsEnabled;
    useEffect(() => {
        if (!isActive || !animationsEnabled) return;
        const start = performance.now();
        const timer = setInterval(() => setTime((performance.now() - start) / 1000), FRAME_MS);
        return () => clearInterval(timer);
    }, [isActive, animationsEnabled]);
    const frameTime = animationsEnabled ? time : STATIC_TIME;

    const finishClose = useCallback(() => {
        if (dontShowAgain) {
            const store = SettingsStore.getInstance();
            const current = store.getAppSettings();
            store.writeAppSettings({
                ...current,
                general: { ...current.general, showWelcomeTutorial: false },
            });
        }
        setClosingAt(null);
        switchBack();
    }, [dontShowAgain, switchBack]);

    // First press plays the outro; a second press (or no animations) closes right away.
    const handleClose = useCallback(() => {
        if (!animationsEnabled || closingAt !== null) finishClose();
        else setClosingAt(time);
    }, [animationsEnabled, closingAt, time, finishClose]);

    const outroK = closingAt === null ? null : Math.min(1, (time - closingAt) / OUTRO_S);
    useEffect(() => {
        if (closingAt === null) return;
        const timer = setTimeout(finishClose, OUTRO_S * 1000);
        return () => clearTimeout(timer);
    }, [closingAt, finishClose]);

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

    // Keys shown inside the animation follow the live bindings, so remaps show up too.
    const importLiteral = useShortcutLiteral("global.import");
    const closeLiteral = useShortcutLiteral("welcomeModal.close");
    const tourOptions = useMemo(
        () => ({ importKeys: importLiteral.split("+"), closeKey: closeLiteral }),
        [importLiteral, closeLiteral]
    );

    const canvasRows = Math.max(1, terminalHeight - FOOTER_ROWS);
    const outro: IntroOutro | undefined = useMemo(
        () =>
            outroK === null
                ? undefined
                : {
                      k: outroK,
                      x: TOOLBAR_LOGO_CELL.x,
                      y: TOOLBAR_LOGO_CELL.y,
                      background: toRGB(theme.ui.background, [0, 0, 0]),
                      extraRows: FOOTER_ROWS,
                  },
        [outroK, theme.ui.background]
    );

    const canvas = useMemo(
        () => (isActive ? renderIntroCanvas(frameTime, terminalWidth, canvasRows, tourOptions, outro) : null),
        [isActive, frameTime, terminalWidth, canvasRows, tourOptions, outro]
    );

    if (!isActive || !canvas) return null;

    // Closing: only the opaque runs of each row are written, so the app shows through the
    // outro's growing hole. No background colours here — they'd paint over the app.
    if (outro) {
        return (
            <Box position="absolute" width={terminalWidth} height={terminalHeight} flexDirection="column">
                {canvas.toSegments().map((segments, y) => (
                    <Box key={y} flexDirection="row" height={1} flexShrink={0}>
                        {segments.map((seg, i) => (
                            <Box
                                key={seg.x}
                                flexShrink={0}
                                width={seg.width}
                                marginLeft={seg.x - (i === 0 ? 0 : segments[i - 1].x + segments[i - 1].width)}
                            >
                                <Text wrap="truncate">{seg.text}</Text>
                            </Box>
                        ))}
                    </Box>
                ))}
            </Box>
        );
    }

    return (
        <Box
            position="absolute"
            width={terminalWidth}
            height={terminalHeight}
            flexDirection="column"
            backgroundColor={BLACK}
        >
            <Box flexDirection="column" flexShrink={0} height={canvasRows} overflow="hidden">
                {canvas.toRows().map((row, i) => (
                    <Text key={i} wrap="truncate">
                        {row}
                    </Text>
                ))}
            </Box>

            <Box
                flexDirection="row"
                flexShrink={0}
                height={FOOTER_ROWS}
                alignItems="center"
                justifyContent="space-between"
                paddingX={2}
                backgroundColor={BLACK}
            >
                <Box flexDirection="row" flexShrink={0}>
                    <Text color={dontShowAgain ? theme.text.active : theme.text.muted}>
                        {dontShowAgain ? "[x]" : "[ ]"}
                    </Text>
                    <Text dimColor>{" Don't show this again"}</Text>
                </Box>
                <Box flexDirection="row" flexShrink={0}>
                    <Hint label="Toggle" shortcutId="welcomeModal.toggle" />
                    <Hint label="Close" shortcutId="welcomeModal.close" />
                </Box>
            </Box>
        </Box>
    );
};
