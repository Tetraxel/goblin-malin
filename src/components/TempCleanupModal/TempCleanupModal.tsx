import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { tempCleanupBridge, TempCleanupView } from "#base/bridges/tempCleanupBridge";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusActions } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";
import { formatSize } from "#utils/formatBytes";
import { Hint } from "../Hint";

interface TempCleanupModalProps {
    terminalHeight: number;
    terminalWidth: number;
}

type ChooseView = Extract<TempCleanupView, { kind: "choose" }>;

const initialIndex = (view: ChooseView): number =>
    Math.max(
        0,
        view.options.findIndex((o) => o.key === view.initialKey)
    );

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The one dialog of the temporary-downloads clean-up (see `tempCleanupBridge`): pick how far back to clean,
 * watch it work, read the result.
 *
 * It is a window of its own for as long as any view is up, so while files are deleted and sessions rewritten
 * neither the keyboard nor the mouse reaches the app underneath. Nothing here can close the "working" box: the
 * clean-up releases it when it is done, whatever happened.
 */
export const TempCleanupModal: React.FC<TempCleanupModalProps> = ({ terminalHeight, terminalWidth }) => {
    const theme = useTheme();
    const { switchWindow, switchBack } = useFocusActions();
    const view = useSyncExternalStore(tempCleanupBridge.subscribe, tempCleanupBridge.get);
    const open = view !== null;

    useEffect(() => {
        tempCleanupBridge.setMounted(true);
        return () => tempCleanupBridge.setMounted(false);
    }, []);

    useEffect(() => {
        if (!open) return;
        switchWindow("tempCleanupModal");
        return () => switchBack();
    }, [open, switchWindow, switchBack]);

    // Each time the question appears it starts on the age picked last time.
    const [index, setIndex] = useState(0);
    const [seen, setSeen] = useState<TempCleanupView | null>(null);
    if (seen !== view) {
        setSeen(view);
        if (view?.kind === "choose" && seen?.kind !== "choose") setIndex(initialIndex(view));
    }

    const optionCount = view?.kind === "choose" ? view.options.length : 1;

    useShortcuts({
        id: "tempCleanupModal",
        isActive: open,
        exclusive: true,
        // Above the other dialogs: nothing may answer for this one, and nothing beneath may hear a key.
        priority: 400,
        shortcuts: [
            {
                id: "tempCleanupModal.left",
                defaultShortcut: { key: "leftArrow" },
                label: "Previous age",
                handler: () => {
                    if (view?.kind === "choose") setIndex((i) => (i - 1 + optionCount) % optionCount);
                },
            },
            {
                id: "tempCleanupModal.right",
                defaultShortcut: { key: "rightArrow" },
                label: "Next age",
                handler: () => {
                    if (view?.kind === "choose") setIndex((i) => (i + 1) % optionCount);
                },
            },
            {
                id: "tempCleanupModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Clean",
                handler: () => {
                    if (view?.kind === "choose") {
                        view.answer({ action: "clean", ageKey: view.options[index]?.key ?? view.initialKey });
                    } else if (view?.kind === "message") view.close();
                },
            },
            {
                id: "tempCleanupModal.cancel",
                defaultShortcut: { key: "escape" },
                label: "Later",
                handler: () => {
                    if (view?.kind === "choose") view.answer({ action: "later" });
                    else if (view?.kind === "message") view.close();
                },
            },
            {
                id: "tempCleanupModal.never",
                defaultShortcut: { input: "n" },
                label: "Don't remind me",
                handler: () => {
                    if (view?.kind === "choose" && view.mode === "reminder") view.answer({ action: "never" });
                },
            },
        ],
    });

    if (!view) return null;

    const modalWidth = Math.min(64, Math.max(40, terminalWidth - 10));
    const accent =
        view.kind === "message"
            ? view.tone === "error"
                ? theme.status.error
                : view.tone === "success"
                  ? theme.status.success
                  : theme.status.warning
            : view.kind === "working"
              ? theme.action.primary
              : theme.status.warning;

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
                borderColor={accent}
                borderBackgroundColor={theme.ui.background}
                backgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                flexShrink={0}
            >
                {view.kind === "choose" && <ChooseBody view={view} index={index} accent={accent} />}

                {view.kind === "working" && (
                    <>
                        <Box flexDirection="row" gap={1}>
                            <Box flexShrink={0}>
                                <AnimatedIcon icon={Icon.Dots} interval={80} color={accent} />
                            </Box>
                            <Text bold color={accent}>
                                {view.title}
                            </Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text color={theme.text.secondary} wrap="truncate-end">
                                {view.step}
                            </Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text dimColor>Please wait — the app is locked until this is done.</Text>
                        </Box>
                    </>
                )}

                {view.kind === "message" && (
                    <>
                        <Text bold color={accent}>
                            {view.title}
                        </Text>
                        <Box marginTop={1} flexDirection="column">
                            {view.lines.map((line, i) => (
                                <Text key={i}>{line}</Text>
                            ))}
                        </Box>
                        <Box marginTop={1} flexDirection="row">
                            <Hint label="OK" shortcutId="tempCleanupModal.confirm" />
                        </Box>
                    </>
                )}
            </Box>
        </Box>
    );
};

const ChooseBody: React.FC<{ view: ChooseView; index: number; accent: string }> = ({ view, index, accent }) => {
    const theme = useTheme();
    const selected = view.options[index];
    const reminder = view.mode === "reminder";

    return (
        <>
            <Text bold color={accent}>
                {reminder ? "Temporary downloads are piling up" : "Clear temporary downloads"}
            </Text>
            <Box marginTop={1} flexDirection="column">
                <Text>
                    {plural(view.totalFiles, "file")} ({formatSize(view.totalBytes)}) in:
                </Text>
                <Text color={theme.text.secondary} wrap="truncate-middle">
                    {view.dir}
                </Text>
            </Box>
            <Box marginTop={1}>
                <Text>Delete what no session has used for at least:</Text>
            </Box>
            <Box marginTop={1} flexDirection="row" flexWrap="wrap">
                {view.options.map((option, i) => {
                    const isSelected = i === index;
                    return (
                        <Box key={option.key} marginRight={1} flexShrink={0}>
                            <Text
                                bold={isSelected}
                                color={isSelected ? theme.ui.background : theme.text.primary}
                                backgroundColor={isSelected ? accent : undefined}
                            >
                                {` ${option.label} `}
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Box marginTop={1} flexDirection="column">
                {selected && selected.files > 0 ? (
                    <Text color={accent} bold>
                        {plural(selected.files, "file")} · {formatSize(selected.bytes)} would be deleted
                    </Text>
                ) : (
                    <Text color={theme.text.secondary}>Nothing is that old.</Text>
                )}
                {selected && selected.liveFiles > 0 && (
                    <Text color={theme.status.warning}>
                        Includes {plural(selected.liveFiles, "file")} of the session open now.
                    </Text>
                )}
                <Text dimColor>Files you saved to your output folder are never touched.</Text>
            </Box>
            <Box marginTop={1} flexDirection="row" flexWrap="wrap">
                <Hint label="Age" shortcutIds={["tempCleanupModal.left", "tempCleanupModal.right"]} />
                <Hint label="Clean" shortcutId="tempCleanupModal.confirm" />
                <Hint label={reminder ? "Later" : "Cancel"} shortcutId="tempCleanupModal.cancel" />
                {reminder && <Hint label="Don't remind me" shortcutId="tempCleanupModal.never" />}
            </Box>
        </>
    );
};
