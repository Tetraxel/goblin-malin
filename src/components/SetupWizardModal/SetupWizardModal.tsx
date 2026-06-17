import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import TextInput from "ink-text-input";
import { Task } from "#base/task/task";
import { PromptType, SetupWizardPrompt } from "#base/task/task-prompt";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { SetupWizardConfig } from "#base/setupWizard";
import { useTheme } from "#base/themeContext";
import { useFocusContext } from "#contexts/FocusContext";
import { openUrl } from "#utils/openUrl";
import { removeEnvVars, saveEnvVar, saveEnvVarsGroup } from "#utils/envFile";
import { useActiveWizardPrompt } from "./useActiveWizardPrompt";
import { Hint } from "../Hint";

type InteractiveItemUnion =
    | { kind: "link"; text: string; url: string }
    | { kind: "field"; envVar: string; label: string; hint?: string }
    | { kind: "mode"; id: string; label: string };

function buildInteractiveItems(config: SetupWizardConfig, selectedMode?: string): InteractiveItemUnion[] {
    const items: InteractiveItemUnion[] = [];

    // If modes are configured, prepend radio-style mode items
    if (config.modes) {
        for (const mode of config.modes) {
            items.push({ kind: "mode", id: mode.id, label: mode.label });
        }
        // Then add fields of the active mode
        const activeMode = config.modes.find((m) => m.id === selectedMode) ?? config.modes[0];
        for (const field of activeMode.fields) {
            items.push({ kind: "field", envVar: field.envVar, label: field.label, hint: field.hint });
        }
        return items;
    }

    for (const block of config.description) {
        if (block.type === "orderedList") {
            for (const item of block.items) {
                if (item.type === "link") {
                    items.push({ kind: "link", text: item.text, url: item.url });
                }
            }
        }
    }
    for (const field of config.fields) {
        items.push({
            kind: "field",
            envVar: field.envVar,
            label: field.label,
            hint: field.hint,
        });
    }
    return items;
}

interface SetupWizardModalProps {
    tasks: Task[];
    terminalHeight: number;
    terminalWidth: number;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ tasks, terminalHeight, terminalWidth }) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const { task: wizardTask, prompt: wizardPrompt, config: autoConfig } = useActiveWizardPrompt(tasks);

    const settingsConfig = focusState.activeWindow === "setupWizardModal" ? focusState.wizardConfig : null;
    const config: SetupWizardConfig | null = autoConfig ?? settingsConfig;

    const isActive = focusState.activeWindow === "setupWizardModal";

    useEffect(() => {
        if (autoConfig) {
            switchWindow("setupWizardModal");
        }
    }, [autoConfig, switchWindow]);

    const [focusedIndex, setFocusedIndex] = useState(0);
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [editingField, setEditingField] = useState<string | null>(null);
    const [selectedMode, setSelectedMode] = useState<string>(() => {
        if (config?.modes && config.modeEnvVar) {
            return process.env[config.modeEnvVar] ?? config.modes[0].id;
        }
        return "";
    });
    const [prevConfig, setPrevConfig] = useState(config);
    if (prevConfig !== config) {
        setPrevConfig(config);
        if (config) {
            setFocusedIndex(0);
            setEditingField(null);
            const initialMode =
                config.modes && config.modeEnvVar
                    ? (process.env[config.modeEnvVar] ?? config.modes[0].id)
                    : "";
            setSelectedMode(initialMode);
            const activeFields = config.modes
                ? (config.modes.find((m) => m.id === initialMode) ?? config.modes[0]).fields
                : config.fields;
            setFieldValues(Object.fromEntries(activeFields.map((f) => [f.envVar, process.env[f.envVar] ?? ""])));
        }
    }

    const interactiveItems = useMemo(
        () => (config ? buildInteractiveItems(config, selectedMode) : []),
        [config, selectedMode]
    );

    const handleSubmit = useCallback(async () => {
        if (!config) return;

        // Determine the active fields (mode-aware)
        const activeFields = config.modes
            ? (config.modes.find((m) => m.id === selectedMode) ?? config.modes[0]).fields
            : config.fields;

        // Always persist to .env and process.env (both settings-triggered and auto-triggered)
        const nonEmpty: Record<string, string> = {};
        const toRemove: string[] = [];

        // Persist modeEnvVar if modes are present
        if (config.modes && config.modeEnvVar) {
            process.env[config.modeEnvVar] = selectedMode;
            nonEmpty[config.modeEnvVar] = selectedMode;
        }

        for (const field of activeFields) {
            const value = fieldValues[field.envVar] ?? "";
            if (value.trim()) {
                process.env[field.envVar] = value;
                nonEmpty[field.envVar] = value;
            } else if (process.env[field.envVar] !== undefined) {
                delete process.env[field.envVar];
                toRemove.push(field.envVar);
            }
        }
        if (toRemove.length > 0) {
            await removeEnvVars(toRemove, config.envSection);
        }
        if (config.envSection && Object.keys(nonEmpty).length > 0) {
            await saveEnvVarsGroup(nonEmpty, config.envSection);
        } else {
            for (const [key, value] of Object.entries(nonEmpty)) {
                await saveEnvVar(key, value);
            }
        }

        // Build the resolved value to pass back to the prompt
        const resolvedValues: Record<string, string> = {};
        if (config.modes && config.modeEnvVar) {
            resolvedValues[config.modeEnvVar] = selectedMode;
        }
        for (const field of activeFields) {
            resolvedValues[field.envVar] = fieldValues[field.envVar] ?? "";
        }

        // If auto-triggered by a task awaiting credentials, resolve the pending prompt
        if (wizardTask && wizardPrompt) {
            const current = wizardPrompt.getCurrentPrompt() as SetupWizardPrompt | null;
            if (current?.type === PromptType.SetupWizard) {
                wizardPrompt.resolvePrompt(resolvedValues);
            }
        }
        switchBack();
    }, [config, fieldValues, selectedMode, wizardTask, wizardPrompt, switchBack]);

    const handleCancel = useCallback(() => {
        if (wizardTask && wizardPrompt) {
            const current = wizardPrompt.getCurrentPrompt() as SetupWizardPrompt | null;
            if (current?.type === PromptType.SetupWizard) {
                current.reject(new Error("Cancelled by user"));
                wizardPrompt.cancelPrompt(new Error("Cancelled by user"));
            }
        }
        switchBack();
    }, [wizardTask, wizardPrompt, switchBack]);

    const handleDisable = useCallback(() => {
        focusState.wizardOnDisable?.();
        switchBack();
    }, [focusState, switchBack]);

    useShortcuts({
        id: "setupWizardModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "setupWizardModal.submit",
                defaultShortcut: { input: "s", ctrl: true },
                label: "Submit",
                handler: () => {
                    if (editingField) setEditingField(null);
                    handleSubmit();
                },
            },
            {
                id: "setupWizardModal.escape",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (editingField) {
                        setEditingField(null);
                        return;
                    }
                    handleCancel();
                },
            },
            {
                id: "setupWizardModal.disable",
                defaultShortcut: { input: "d" },
                label: "Disable service",
                handler: () => {
                    if (!editingField) handleDisable();
                },
            },
            {
                id: "setupWizardModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => {
                    if (!editingField) setFocusedIndex((prev) => Math.max(0, prev - 1));
                },
            },
            {
                id: "setupWizardModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => {
                    if (!editingField) setFocusedIndex((prev) => Math.min(interactiveItems.length - 1, prev + 1));
                },
            },
            {
                id: "setupWizardModal.enter",
                defaultShortcut: { key: "return" },
                label: "Open/Edit",
                handler: () => {
                    if (editingField) return;
                    const item = interactiveItems[focusedIndex];
                    if (!item) return;
                    if (item.kind === "link") openUrl(item.url);
                    else if (item.kind === "field") setEditingField(item.envVar);
                    else if (item.kind === "mode") {
                        const newMode = item.id;
                        setSelectedMode(newMode);
                        // Reset field values to current env values for the newly selected mode
                        if (config?.modes) {
                            const newActiveMode = config.modes.find((m) => m.id === newMode) ?? config.modes[0];
                            setFieldValues((prev) => ({
                                ...prev,
                                ...Object.fromEntries(
                                    newActiveMode.fields.map((f) => [f.envVar, process.env[f.envVar] ?? ""])
                                ),
                            }));
                        }
                    }
                },
            },
        ],
    });

    if (!isActive || !config) return null;

    const borderColor = config.providerKey
        ? providerDisplayRegistry.get(config.providerKey).color
        : theme.ui.modalBorder;

    const modalWidth = Math.min(80, Math.max(60, terminalWidth - 6));

    // Determine active fields for labelWidth (mode-aware)
    const activeFields = config.modes
        ? (config.modes.find((m) => m.id === selectedMode) ?? config.modes[0]).fields
        : config.fields;
    const labelWidth = activeFields.length > 0 ? Math.max(...activeFields.map((f) => f.label.length)) + 2 : 2;

    // Active mode description (for modes config)
    const activeModeDescription = config.modes
        ? (config.modes.find((m) => m.id === selectedMode) ?? config.modes[0]).description
        : undefined;

    let linkInteractiveIndex = 0;

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
                borderColor={borderColor}
                borderBackgroundColor={theme.ui.background}
                paddingX={2}
                paddingY={1}
                width={modalWidth}
                backgroundColor={theme.ui.background}
            >
                <Text bold color={borderColor}>
                    {config.title}
                </Text>

                {/* Mode chooser (when modes are configured) */}
                {config.modes && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text dimColor>{"  Choose how to fetch Spotify metadata:"}</Text>
                        {config.modes.map((mode, mi) => {
                            const itemIndex = interactiveItems.findIndex(
                                (it) => it.kind === "mode" && it.id === mode.id
                            );
                            const isFocused = focusedIndex === itemIndex;
                            const isSelected = selectedMode === mode.id;
                            return (
                                <Box key={mode.id} flexDirection="row" marginTop={mi === 0 ? 0 : 0}>
                                    <Text color={isFocused ? theme.text.active : theme.text.muted}>
                                        {isFocused ? "☛ " : "  "}
                                    </Text>
                                    <Text color={isSelected ? theme.text.active : theme.text.secondary}>
                                        {isSelected ? "◉ " : "○ "}
                                    </Text>
                                    <Text
                                        color={isFocused ? theme.text.active : theme.text.secondary}
                                        bold={isSelected}
                                    >
                                        {mode.label}
                                    </Text>
                                </Box>
                            );
                        })}
                        {activeModeDescription && (
                            <Box marginTop={1}>
                                <Text dimColor>{"  "}</Text>
                                <Text dimColor>{activeModeDescription}</Text>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Description blocks (non-modes path) */}
                {!config.modes && (
                    <Box flexDirection="column" marginTop={1}>
                        {config.description.map((block, bi) => {
                            if (block.type === "note") {
                                return (
                                    <Box key={bi} flexDirection="column" marginBottom={1}>
                                        <Box flexDirection="row">
                                            <Text color={theme.palette.blue}>{"│ "}</Text>
                                            <Text color={theme.palette.blue} bold>
                                                {"ℹ Note"}
                                            </Text>
                                        </Box>
                                        <Box flexDirection="row">
                                            <Text color={theme.palette.blue}>{"│ "}</Text>
                                            <Text dimColor>{block.text}</Text>
                                        </Box>
                                    </Box>
                                );
                            }
                            if (block.type === "paragraph") {
                                return (
                                    <Box key={bi} marginBottom={1}>
                                        <Text>{block.text}</Text>
                                    </Box>
                                );
                            }
                            if (block.type === "orderedList") {
                                return (
                                    <Box key={bi} flexDirection="column">
                                        {block.items.map((item, ii) => {
                                            const myIndex = linkInteractiveIndex;
                                            if (item.type === "link") linkInteractiveIndex++;
                                            const isFocused =
                                                isActive && item.type === "link" && focusedIndex === myIndex;
                                            return (
                                                <Box key={ii} flexDirection="row">
                                                    <Text color={isFocused ? theme.text.active : theme.text.muted}>
                                                        {isFocused ? "☛ " : "  "}
                                                    </Text>
                                                    <Text color={theme.text.muted}>
                                                        {ii + 1}
                                                        {"."}{" "}
                                                    </Text>
                                                    {item.type === "link" ? (
                                                        <Text
                                                            color={theme.palette.blue}
                                                            underline={isFocused}
                                                            backgroundColor={
                                                                isFocused ? theme.ui.rowActiveBackground : undefined
                                                            }
                                                        >
                                                            {item.text}
                                                        </Text>
                                                    ) : (
                                                        <Text>{item.text}</Text>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                );
                            }
                            return null;
                        })}
                    </Box>
                )}

                {/* Fields (active mode fields when modes present, all fields otherwise) */}
                <Box flexDirection="column" marginTop={1}>
                    {activeFields.map((field, fi) => {
                        const itemIndex = interactiveItems.findIndex(
                            (it) => it.kind === "field" && it.envVar === field.envVar
                        );
                        const isFocused = focusedIndex === itemIndex;
                        const isEditing = editingField === field.envVar;

                        return (
                            <Box
                                flexDirection="row"
                                key={field.envVar}
                                marginTop={fi === 0 ? 1 : 0}
                                height={3}
                                alignItems="center"
                            >
                                <Text color={isFocused ? theme.text.active : theme.text.muted}>
                                    {isFocused ? "☛ " : "  "}
                                </Text>
                                <Text color={isFocused ? theme.text.active : theme.text.secondary} bold={isFocused}>
                                    {field.label.padEnd(labelWidth)}
                                </Text>
                                <Box
                                    borderStyle="single"
                                    borderColor={
                                        isEditing
                                            ? theme.action.primary
                                            : isFocused
                                              ? theme.ui.selection
                                              : theme.text.secondary
                                    }
                                    borderBackgroundColor={theme.ui.background}
                                    paddingX={1}
                                    flexGrow={1}
                                >
                                    {isEditing ? (
                                        <TextInput
                                            value={fieldValues[field.envVar] ?? ""}
                                            onChange={(v) =>
                                                setFieldValues((prev) => ({
                                                    ...prev,
                                                    [field.envVar]: v,
                                                }))
                                            }
                                            onSubmit={() => setEditingField(null)}
                                            placeholder={field.hint ?? ""}
                                            focus={true}
                                        />
                                    ) : (
                                        <Text dimColor={!fieldValues[field.envVar]}>
                                            {fieldValues[field.envVar] || field.hint || ""}
                                        </Text>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>

                {/* Footer */}
                <Box marginTop={1} flexDirection="row" flexWrap="wrap">
                    <Hint label="Navigate" shortcut="↑↓" />
                    <Hint label="Open/Edit" shortcut="Enter" />
                    <Hint label="Submit" shortcut="Ctrl+S" />
                    {wizardTask ? (
                        <Hint label="Cancel & Disable service" shortcut="Esc" />
                    ) : (
                        <>
                            <Hint label="Cancel" shortcut="Esc" />
                            <Hint label="Disable service" shortcut="D" />
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
};
