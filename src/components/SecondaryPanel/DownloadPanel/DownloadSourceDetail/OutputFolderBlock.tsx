import React from "react";
import * as path from "path";
import { Box, Text } from "ink";
import { TextInput } from "#components/TextInput";
import { useTheme } from "#base/themeContext";
import { ClickableBox } from "./FocusRow";

export interface OutputFolderEdit {
    draft: string;
    error: string | null;
    inputKey: number;
    onChange: (draft: string) => void;
    onSubmit: (draft: string) => void;
}

/**
 * The "OUTPUT FOLDER" block under the file panel(s): the whole target path, wrapped rather than truncated,
 * and the folder's state (Settings default, custom, to be created) or a short-lived notice.
 */
export function OutputFolderBlock({
    width,
    label,
    dir,
    filename,
    isOverridden,
    folderExists,
    isFocused,
    notice,
    replacesExisting,
    edit,
    onClick,
}: {
    width: number;
    /** The block title. */
    label: string;
    dir: string;
    filename: string;
    isOverridden: boolean;
    folderExists: boolean;
    isFocused: boolean;
    notice: string | null;
    /** Another file already has this name: saving replaces it, after the user confirms. */
    replacesExisting: boolean;
    /** The draft of the folder being typed; null when it is not being edited. */
    edit: OutputFolderEdit | null;
    onClick: () => void;
}) {
    const theme = useTheme();
    const color = isFocused ? theme.text.active : theme.text.secondary;
    const dashes = Math.max(0, width - label.length - 4);
    const left = Math.floor(dashes / 2);
    return (
        <ClickableBox onClick={onClick}>
            <Box flexDirection="column" flexShrink={0} width={width}>
                <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
                    <Text color={color}>{`┌${"─".repeat(left)} `}</Text>
                    <Text color={color} bold={isFocused}>
                        {label}
                    </Text>
                    <Text color={color}>{` ${"─".repeat(dashes - left)}┐`}</Text>
                </Box>
                <Box
                    flexDirection="column"
                    flexShrink={0}
                    paddingX={1}
                    borderStyle="single"
                    borderColor={color}
                    borderBackgroundColor={theme.ui.background}
                    borderTop={false}
                >
                    {edit ? (
                        <Box flexDirection="column" flexShrink={0}>
                            <TextInput
                                key={edit.inputKey}
                                value={edit.draft}
                                onChange={edit.onChange}
                                onSubmit={edit.onSubmit}
                            />
                            <Text color={edit.error ? theme.field.error : theme.text.secondary} dimColor={!edit.error}>
                                {edit.error
                                    ? `✗ ${edit.error}`
                                    : "Paste or type a folder · a file name or quotes are removed"}
                            </Text>
                        </Box>
                    ) : (
                        <Box flexDirection="column" flexShrink={0}>
                            {/* Wrapped, never truncated: the whole path has to be readable. */}
                            <Text wrap="wrap" underline={isFocused}>
                                <Text color={theme.text.secondary}>{dir + path.sep}</Text>
                                <Text color={theme.text.primary}>{filename}</Text>
                            </Text>
                            <Text
                                color={
                                    notice
                                        ? theme.status.warning
                                        : isOverridden
                                          ? theme.field.overridden
                                          : theme.text.secondary
                                }
                                dimColor={!notice && !isOverridden}
                                wrap="wrap"
                            >
                                {notice ??
                                    (isOverridden ? "Custom folder for this track" : "Default folder (Settings)") +
                                        (folderExists ? "" : " · will be created")}
                            </Text>
                            {replacesExisting && (
                                <Text color={theme.status.warning} bold wrap="wrap">
                                    △ A different file already has this name: saving will replace it (you will be asked
                                    first)
                                </Text>
                            )}
                        </Box>
                    )}
                </Box>
            </Box>
        </ClickableBox>
    );
}
