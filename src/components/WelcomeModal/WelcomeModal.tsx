import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { SettingsStore } from "#settings/settingsStore";
import { useTheme } from "#base/themeContext";
import { TOOLBAR_LOGO_CELL } from "../Toolbar/Toolbar";
import { MpvMix } from "#utils/mpvMix";
import { DirectPainter } from "./intro/directPainter";
import { exitApp } from "#utils/exitApp";
import { FINALE, IntroOutro, renderIntroCanvas, T } from "./intro/introScene";
import { INTRO_CUES, OUTRO_CUES, OUTRO_SONG_END, SOUND_VOLUME } from "./intro/introSounds";
import { TourOptions } from "./intro/tourShared";
import { toRGB } from "./intro/ui";

// The intro needs fluid motion, so it runs its own ~30fps clock instead of the shared
// 125ms useGlobalTicker (which is tuned for spinners). It only ticks while visible.
const FRAME_MS = 33;
// Pose shown when animations are disabled: the face fully revealed, eyes open.
const STATIC_TIME = T.IDLE + 2;
// Closing: the content fades out while the mascot shrinks onto the toolbar's 😉.
const OUTRO_S = 1.2;
const FOOTER_ROWS = 2;
// How long the first frame may wait for the sounds. A mix can't join late (see MpvMix), so
// past this the intro plays silently, e.g. on the first launch, while mpv downloads.
const MAX_SOUND_WAIT_MS = 2000;
// The song starts with the finale's prompt, and the app closes when it ends.
const QUIT_AT = FINALE.PROMPT + OUTRO_SONG_END;
const QUIT_CHECK_MS = 1000;

const BLACK = "#000000";

interface WelcomeModalProps {
    terminalHeight: number;
    terminalWidth: number;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ terminalHeight, terminalWidth }) => {
    const theme = useTheme();
    const { stdout } = useStdout();
    const { switchWindow, switchBack } = useFocusActions();
    const { activeWindow } = useFocusChrome();
    const isActive = activeWindow === "welcomeModal";
    const [dontShowAgain, setDontShowAgain] = useState(false);
    // Intro time at which closing started, or null while the intro plays.
    const [closingAt, setClosingAt] = useState<number | null>(null);
    // Only ticks during the outro: while playing, frames bypass React entirely.
    const [time, setTime] = useState(0);
    const startedAt = useRef<number | null>(null);
    const clockReady = useRef(false);
    const sounds = useRef<MpvMix | null>(null);
    const outroSounds = useRef<MpvMix | null>(null);
    const closing = closingAt !== null;

    useEffect(() => {
        const settings = SettingsStore.getInstance().getAppSettings();
        if (settings.general.showWelcomeTutorial) {
            switchWindow("welcomeModal");
        }
    }, [switchWindow]);

    const animationsEnabled = SettingsStore.getInstance().getAppSettings().general.animationsEnabled;

    const elapsed = useCallback(() => {
        if (startedAt.current === null) startedAt.current = performance.now();
        return (performance.now() - startedAt.current) / 1000;
    }, []);

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
        startedAt.current = null;
        switchBack();
    }, [dontShowAgain, switchBack]);

    // First press plays the outro; a second press (or no animations) closes right away.
    const handleClose = useCallback(() => {
        if (!animationsEnabled || closing) {
            finishClose();
            return;
        }
        const now = elapsed();
        setTime(now);
        setClosingAt(now);
        sounds.current?.fadeOut(OUTRO_S / 2);
        outroSounds.current?.resume();
    }, [animationsEnabled, closing, elapsed, finishClose]);

    // The intro opens on black, so holding its clock until the sounds start doesn't show,
    // and it keeps them in sync with the picture.
    const playing = isActive && animationsEnabled;
    useEffect(() => {
        if (!playing) return;
        const mix = new MpvMix(INTRO_CUES, SOUND_VOLUME);
        const outroMix = new MpvMix(OUTRO_CUES, SOUND_VOLUME, true);
        sounds.current = mix;
        outroSounds.current = outroMix;
        const giveUp = setTimeout(() => {
            mix.stop();
            outroMix.stop();
            clockReady.current = true;
        }, MAX_SOUND_WAIT_MS);
        void mix.started.then((timeZero) => {
            clearTimeout(giveUp);
            if (timeZero !== null && startedAt.current === null) startedAt.current = timeZero;
            clockReady.current = true;
        });
        return () => {
            clearTimeout(giveUp);
            mix.stop();
            outroMix.dismiss(); // once playing, it outlasts the intro: the wink lands on the app
            sounds.current = null;
            outroSounds.current = null;
            clockReady.current = false;
        };
    }, [playing]);

    // The finale's song has an end: if Esc never came by then, so does the app. Measured on
    // the intro's clock, which started with the sounds.
    useEffect(() => {
        if (!playing || closing) return;
        const watch = setInterval(() => {
            if (clockReady.current && elapsed() >= QUIT_AT) exitApp();
        }, QUIT_CHECK_MS);
        return () => clearInterval(watch);
    }, [playing, closing, elapsed]);

    useEffect(() => {
        if (!closing) return;
        const ticker = setInterval(() => setTime(elapsed()), FRAME_MS);
        const timer = setTimeout(finishClose, OUTRO_S * 1000);
        return () => {
            clearInterval(ticker);
            clearTimeout(timer);
        };
    }, [closing, elapsed, finishClose]);

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
    const toggleLiteral = useShortcutLiteral("welcomeModal.toggle");
    const options: TourOptions = useMemo(
        () => ({
            importKeys: importLiteral.split("+"),
            closeKey: closeLiteral,
            footer: {
                dontShowAgain,
                toggleKey: toggleLiteral,
                colors: {
                    active: toRGB(theme.text.active),
                    muted: toRGB(theme.text.muted),
                    hint: toRGB(theme.text.hint),
                },
            },
        }),
        [importLiteral, closeLiteral, toggleLiteral, dontShowAgain, theme.text]
    );

    const sceneRows = Math.max(1, terminalHeight - FOOTER_ROWS);

    // While playing, paint straight to the terminal (see DirectPainter). The effect re-runs
    // on resize: its fresh painter repaints the whole screen once Ink has redrawn it.
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    }, [options]);
    const painting = isActive && animationsEnabled && !closing;
    useEffect(() => {
        if (!painting) return;
        const painter = new DirectPainter(stdout);
        const timer = setInterval(() => {
            if (!painter.ready || !clockReady.current) return;
            painter.paint(renderIntroCanvas(elapsed(), terminalWidth, sceneRows, FOOTER_ROWS, optionsRef.current));
        }, FRAME_MS);
        return () => clearInterval(timer);
    }, [painting, stdout, elapsed, terminalWidth, sceneRows]);

    const outro: IntroOutro | undefined = useMemo(
        () =>
            closingAt === null
                ? undefined
                : {
                      k: Math.min(1, (time - closingAt) / OUTRO_S),
                      x: TOOLBAR_LOGO_CELL.x,
                      y: TOOLBAR_LOGO_CELL.y,
                      background: toRGB(theme.ui.background, [0, 0, 0]),
                  },
        [closingAt, time, theme.ui.background]
    );

    const canvas = useMemo(
        () =>
            isActive && !painting
                ? renderIntroCanvas(
                      animationsEnabled ? time : STATIC_TIME,
                      terminalWidth,
                      sceneRows,
                      FOOTER_ROWS,
                      options,
                      outro
                  )
                : null,
        [isActive, painting, animationsEnabled, time, terminalWidth, sceneRows, options, outro]
    );

    if (!isActive) return null;

    // Just a black backdrop for the painter: it never changes, so Ink writes nothing.
    if (!canvas) {
        return <Box position="absolute" width={terminalWidth} height={terminalHeight} backgroundColor={BLACK} />;
    }

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
        <Box position="absolute" width={terminalWidth} height={terminalHeight} flexDirection="column">
            {canvas.toRows().map((row, i) => (
                <Text key={i} wrap="truncate">
                    {row}
                </Text>
            ))}
        </Box>
    );
};
