import React, { useCallback, useState } from "react";
import { Box, Text } from "ink";
import clipboard from "clipboardy";
import { MetadataResultState, MetadataOverrides } from "#flows/musicDownloadFlow/types";
import { CompiledMetadata, CompiledMetadataField } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { FIELDS, navigableFields } from "#flows/musicDownloadFlow/utils/metadataFields";
import { useShortcuts } from "#hooks/useShortcuts";
import { FieldRow } from "./FieldRow";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";

interface MetadataSourceDetailProps {
    source: MetadataResultState | "compiled";
    compiled: CompiledMetadata;
    overrides: MetadataOverrides;
    selectedFieldIndex: number;
    isActive: boolean;
    width: number;
    height: number;
    onOverrideChange: (overrides: MetadataOverrides) => void;
    onInnerFocusSwitch: () => void;
    setIsEditingField: (editing: boolean) => void;
}

function getPlatformBrightColor(apiProvider: string): string {
    return providerDisplayRegistry.get(apiProvider).colorBright;
}

export const MetadataDetailPanel: React.FC<MetadataSourceDetailProps> = ({
    source,
    compiled,
    overrides,
    selectedFieldIndex,
    isActive,
    width,
    onOverrideChange,
    onInnerFocusSwitch,
    setIsEditingField,
}) => {
    const theme = useTheme();
    const [editingField, setEditingField] = useState<CompiledMetadataField | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editError, setEditError] = useState(false);

    function startEditing(fieldKey: CompiledMetadataField, initialValue: string) {
        setEditValue(initialValue);
        setEditError(false);
        setEditingField(fieldKey);
        setIsEditingField(true);
    }

    const stopEditing = useCallback(() => {
        setEditingField(null);
        setEditError(false);
        setIsEditingField(false);
    }, [setIsEditingField]);

    const isCompiled = source === "compiled";
    const clampedFieldIdx = Math.min(selectedFieldIndex, navigableFields.length - 1);

    useShortcuts({
        id: "metadataDetail",
        isActive,
        priority: 200,
        shortcuts: [
            {
                id: "metadataDetail.back",
                defaultShortcut: { key: "leftArrow" },
                label: "Back",
                handler: () => {
                    if (editingField === null) onInnerFocusSwitch();
                },
            },
            {
                id: "metadataDetail.cancelEdit",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (editingField !== null) stopEditing();
                },
            },
            {
                id: "metadataDetail.edit",
                defaultShortcut: { key: "return" },
                label: "Edit",
                handler: () => {
                    if (editingField !== null || !isCompiled) return;
                    const field = navigableFields[clampedFieldIdx];
                    if (!field) return;
                    const currentValue = field.getCompiledValue(compiled);
                    startEditing(field.key, currentValue === "—" ? "" : currentValue);
                },
            },
            {
                id: "metadataDetail.clear",
                defaultShortcut: { key: "delete" },
                label: "Clear override",
                handler: () => {
                    if (editingField !== null || !isCompiled) return;
                    const field = navigableFields[clampedFieldIdx];
                    if (!field) return;
                    const updated = { ...overrides };
                    delete (updated as Record<string, unknown>)[field.key];
                    onOverrideChange(updated);
                },
            },
            {
                id: "metadataDetail.copy",
                defaultShortcut: { input: "c", ctrl: true },
                label: "Copy",
                handler: () => {
                    const field = navigableFields[clampedFieldIdx];
                    if (!field) return;
                    const value = isCompiled
                        ? field.getCompiledValue(compiled)
                        : field.getSourceValue(source as MetadataResultState);
                    if (value !== "—")
                        try {
                            clipboard.writeSync(value);
                        } catch {
                            /* ignored */
                        }
                },
            },
        ],
        hintLines: isActive
            ? [
                  {
                      id: "metadataDetail.line.actions",
                      left: { type: "text", value: "Field", bold: true },
                      shortcutIds:
                          editingField !== null
                              ? ["metadataDetail.cancelEdit"]
                              : isCompiled
                                ? ["metadataDetail.edit", "metadataDetail.copy"]
                                : ["metadataDetail.copy"],
                  },
              ]
            : [],
    });

    const handleEditSubmit = useCallback(
        (value: string) => {
            if (!editingField) return;
            const field = FIELDS.find((f) => f.key === editingField);
            if (!field) return;

            const currentDisplay = field.getCompiledValue(compiled);
            if (value === currentDisplay || (currentDisplay === "—" && value === "")) {
                stopEditing();
                return;
            }

            let parsed: unknown = value;
            if (field.parseValue) {
                parsed = field.parseValue(value);
                if (parsed === null) {
                    setEditError(true);
                    return;
                }
            }

            onOverrideChange({ ...overrides, [editingField]: parsed });
            stopEditing();
        },
        [editingField, compiled, overrides, onOverrideChange, stopEditing]
    );

    const titleInner = width - 2;
    const headerLabel = isCompiled ? "Compiled Metadata" : source.metadata.platform.toUpperCase();
    const dashes = Math.max(0, titleInner - headerLabel.length - 2);
    const leftD = Math.floor(dashes / 2);
    const rightD = dashes - leftD + 1;
    const borderLeft = `┌${"─".repeat(leftD)} `;
    const borderRight = ` ${"─".repeat(rightD)}┐`;
    const platformColor = isCompiled
        ? theme.text.secondary
        : getPlatformBrightColor((source as MetadataResultState).metadata.apiProvider);

    return (
        <Box flexDirection="column" width={width} flexGrow={1} overflow="hidden">
            <Box flexDirection="column" height={1} flexShrink={0} overflow="hidden">
                <Box flexDirection="row">
                    <Text color={theme.text.secondary}>{borderLeft}</Text>
                    <Text color={platformColor}>{headerLabel}</Text>
                    <Text color={theme.text.secondary}>{borderRight}</Text>
                </Box>
            </Box>

            <Box
                flexDirection="column"
                flexGrow={1}
                overflow="hidden"
                borderStyle="single"
                borderColor={theme.text.secondary}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
            >
                <Box flexDirection="column" flexGrow={1} overflow="hidden">
                    <Box flexDirection="column" flexShrink={0}>
                        {FIELDS.map((field) => {
                            const isFocused = isActive && navigableFields[clampedFieldIdx]?.key === field.key;
                            const value = isCompiled
                                ? field.getCompiledValue(compiled)
                                : field.getSourceValue(source as MetadataResultState);
                            const attr = isCompiled ? compiled.attribution[field.key] : undefined;
                            const isEditing = editingField === field.key;
                            const hasOverride =
                                isCompiled && overrides[field.key as keyof MetadataOverrides] !== undefined;
                            return (
                                <FieldRow
                                    key={field.key}
                                    field={field}
                                    isFocused={isFocused}
                                    isCompiled={isCompiled}
                                    isEditing={isEditing}
                                    value={value}
                                    attribution={attr}
                                    hasOverride={hasOverride}
                                    // Only the editing row gets live edit state, so the other
                                    // rows keep stable props and stay memo-bailed while typing.
                                    editValue={isEditing ? editValue : ""}
                                    editError={isEditing ? editError : false}
                                    onEditValueChange={setEditValue}
                                    onEditSubmit={handleEditSubmit}
                                />
                            );
                        })}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
