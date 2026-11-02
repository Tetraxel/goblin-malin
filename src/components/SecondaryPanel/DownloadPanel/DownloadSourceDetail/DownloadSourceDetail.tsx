import React, { useState, useEffect, useRef, type RefObject } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import TextInput from "ink-text-input";
import clipboard from "clipboardy";
import * as path from "path";
import * as fs from "fs";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { MetadataOverrides, TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { FIELDS, FieldDef } from "#flows/musicDownloadFlow/utils/metadataFields";
import { computeOutputFilename } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import {
    cleanOutputDir,
    cleanOutputFilename,
    isSameDir,
    OUTPUT_EXTENSION,
    stripOutputExtension,
} from "#flows/musicDownloadFlow/utils/cleanOutputDir";
import { getProvenanceDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { getInstance, PlayerStatus } from "#utils/mpvPlayer";
import { togglePlayback as toggleFilePlayback, playFrom } from "#utils/togglePlayback";
import { formatBytes, formatDate, tagValue } from "#components/SecondaryPanel/DownloadPanel/utils";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";
import { attributionBadge } from "#components/SecondaryPanel/MetadataPanel/FieldRow";
import { useShortcuts } from "#hooks/useShortcuts";
import { Hint } from "#components/Hint";
import { PlaybackBar } from "../PlaybackBar";
import { DiffView } from "./DiffView";
import { DownloadInProgress } from "./DownloadInProgress";
import { DetailRow } from "./DetailRow";
import { AttributesHeader, ClickableBox, FocusRow, FocusRowEdit } from "./FocusRow";
import { windowRows, WindowRow } from "./windowRows";
import { formatDuration } from "../../utils";

interface DownloadSourceDetailProps {
    source: TrackDownloadSource | null;
    savedSource: TrackDownloadSource | null;
    compiled: CompiledMetadata | null;
    /** The track's own metadata edits (the same ones the Metadata tab makes). */
    overrides: MetadataOverrides;
    /** Folder this track will be saved to: the per-track override when set, else `defaultOutputDir`. */
    outputDir: string;
    /** Folder from Settings, used when the track has no override of its own. */
    defaultOutputDir: string;
    isOutputOverridden: boolean;
    /** Name chosen for this track instead of "Artist - Title.flac"; undefined when it has none. */
    filenameOverride: string | undefined;
    /** Whether saving writes the compiled metadata into the file's tags. */
    overwriteTags: boolean;
    /** What the diff view should show as the new file name. */
    previewFilename: string | null;
    isDiffMode: boolean;
    diffKind: "source-switch" | "metadata-change";
    pendingSource: TrackDownloadSource | null;
    isActive: boolean;
    isSaving: boolean;
    width: number;
    height: number;
    onInnerFocusSwitch: () => void;
    onConfirmDiff: () => void;
    onCancelDiff: () => void;
    onRelocateFile: () => void;
    onSave: () => void;
    /** `undefined` goes back to the default folder. */
    onChangeOutputDir: (dir: string | undefined) => void;
    /** `undefined` goes back to the "Artist - Title.flac" name. */
    onChangeFilename: (filename: string | undefined) => void;
    onChangeOverwriteTags: (overwrite: boolean) => void;
    onOverridesChange: (overrides: MetadataOverrides) => void;
    setIsEditingField: (editing: boolean) => void;
    /** A click landed in this pane: give it keyboard focus. */
    onFocusPane: () => void;
}

const PRIORITY_TAGS = ["TITLE", "ARTIST", "ALBUM", "DATE", "TRACKNUMBER", "ISRC", "BPM", "KEY"];

// The file's own duration is its own row; the compiled duration is not written to the tags.
const META_FIELDS = FIELDS.filter((f) => f.key !== "duration");
const fieldTarget = (f: FieldDef) => `field:${f.key}`;
const findField = (target: string) => META_FIELDS.find((f) => fieldTarget(f) === target);

// How long a one-line message under the output path ("Folder copied"…) stays visible.
const NOTICE_MS = 3000;

/** The text `next` gained compared to `prev` (a typed key is 1 char; a terminal paste is a whole chunk). */
function insertedText(prev: string, next: string): string {
    const maxCommon = Math.min(prev.length, next.length);
    let start = 0;
    while (start < maxCommon && prev[start] === next[start]) start++;
    let end = 0;
    while (end < maxCommon - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
    return next.slice(start, next.length - end);
}

/** Whether a pasted chunk is a path from outside the app, to be cleaned and to replace the whole draft. */
function replacesDraft(target: string, chunk: string): boolean {
    if (chunk.length < 2) return false;
    if (target === "output") return true;
    return target === "filename" && /[\\/]/.test(chunk);
}

function SectionDivider({ label, width }: { label: string; width: number }) {
    const theme = useTheme();
    // `width` is the inside of the bordered pane. The text area is that minus the row's own 1-column padding
    // on each side, and a line longer than it wraps onto the next row: "── ", the label and a space come first.
    const dashes = Math.max(0, width - 2 - label.length - 4);
    return (
        <Box paddingX={1} height={1} flexDirection="column">
            <Text color={theme.text.secondary} wrap="truncate-end">
                {"── "}
                {label}
                {" " + "─".repeat(dashes)}
            </Text>
        </Box>
    );
}

interface DetailRowSpec extends WindowRow {
    node: React.ReactNode;
}

interface EditState {
    /** What is being edited: a `field:<key>`, "filename" or "output". */
    target: string;
    draft: string;
    error: string | null;
    inputKey: number;
}

export const DownloadSourceDetail: React.FC<DownloadSourceDetailProps> = ({
    source,
    savedSource,
    compiled,
    overrides,
    outputDir,
    defaultOutputDir,
    isOutputOverridden,
    filenameOverride,
    overwriteTags,
    previewFilename,
    isDiffMode,
    diffKind,
    pendingSource,
    isActive,
    isSaving,
    width,
    height,
    onInnerFocusSwitch,
    onConfirmDiff,
    onCancelDiff,
    onRelocateFile,
    onSave,
    onChangeOutputDir,
    onChangeFilename,
    onChangeOverwriteTags,
    onOverridesChange,
    setIsEditingField,
    onFocusPane,
}) => {
    const theme = useTheme();
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);

    // Where the cursor is: "player", "overwrite", a `field:<key>`, "filename" or "output".
    const [cursor, setCursor] = useState("player");
    // The draft of whatever is being typed; null when nothing is.
    const [edit, setEdit] = useState<EditState | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const isEditing = edit !== null;

    // The part of the pane the rows scroll in; its height decides how many rows are drawn.
    const viewportRef = useRef<DOMElement>(null);
    // useBoxMetrics wants a non-null ref type; the ref is simply empty until the pane first renders.
    const viewport = useBoxMetrics(viewportRef as RefObject<DOMElement>);

    // Losing focus abandons a half-typed value. The cursor stays where it was: the mouse wheel moves it
    // without taking focus, and the pane shows it again once focused.
    const [prevIsActive, setPrevIsActive] = useState(isActive);
    if (prevIsActive !== isActive) {
        setPrevIsActive(isActive);
        if (!isActive) setEdit(null);
    }

    // The app-wide "typing" flag must never outlive the draft: however editing ends (applied, cancelled,
    // focus lost) or this pane goes away (task/tab switch), the cleanup hands the keyboard back.
    useEffect(() => {
        if (!isEditing) return;
        return () => setIsEditingField(false);
    }, [isEditing, setIsEditingField]);

    useEffect(() => {
        if (notice === null) return;
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    const currentFilePath = source?.localFile?.path ?? null;

    useEffect(() => {
        const player = getInstance();

        function syncFromStatus(status: PlayerStatus) {
            const isThisFile = status.filePath === currentFilePath;
            setIsPlaying(isThisFile && status.isPlaying);
            setIsPaused(isThisFile && status.isPaused);
            if (isThisFile) {
                setPositionMs(status.positionMs);
                setDurationMs(status.durationMs);
            } else {
                setPositionMs(0);
                setDurationMs(0);
            }
        }

        const onProgress = (pos: number, dur: number) => {
            if (player.getStatus().filePath === currentFilePath) {
                setPositionMs(pos);
                setDurationMs(dur);
            }
        };
        const onStateChange = (status: PlayerStatus) => syncFromStatus(status);
        const onEnded = () => {
            setIsPlaying(false);
            setIsPaused(false);
            setPositionMs(0);
        };

        player.on("progress", onProgress);
        player.on("stateChange", onStateChange);
        player.on("ended", onEnded);
        syncFromStatus(player.getStatus());

        return () => {
            player.off("progress", onProgress);
            player.off("stateChange", onStateChange);
            player.off("ended", onEnded);
        };
    }, [currentFilePath]);

    // Playback is intentionally NOT stopped when this panel switches file or unmounts: music
    // keeps playing in the background while you move between tasks and tabs (the playing task
    // is flagged in the task list, and the player is the app-wide singleton).

    const canPlay = source?.localFile?.state === "found";
    // Shared by the Space shortcut and a click on the playback bar. Only a file that is already
    // loaded can be paused; starting one needs it to be on disk.
    const togglePlayback = () => {
        if (!currentFilePath) return;
        const status = getInstance().getStatus();
        const isLoaded = status.filePath === currentFilePath && (status.isPlaying || status.isPaused);
        if (isLoaded || canPlay) toggleFilePlayback(currentFilePath);
    };
    // A click on the track goes there in one click: seek when the file is loaded, otherwise start it from there.
    const seekToFraction = (fraction: number) => {
        const status = getInstance().getStatus();
        if (status.filePath === currentFilePath && status.durationMs > 0) {
            getInstance()
                .seekMs(Math.round(fraction * status.durationMs))
                .catch(() => {});
            return;
        }
        const knownDurationMs = source?.fileInfo?.durationMs ?? source?.track.duration ?? 0;
        if (canPlay && currentFilePath && knownDurationMs > 0) {
            playFrom(currentFilePath, Math.round(fraction * knownDurationMs));
        }
    };
    const fileNotFoundNow = source?.localFile?.state === "not_found";

    // ── Cursor ────────────────────────────────────────────────────────────────

    // Everything the cursor can land on, in the order it appears on screen.
    const hasEditableRows = !!source && (!!source.localFile || !!source.savedFile) && !fileNotFoundNow && !!compiled;
    const targets: string[] = [];
    if (canPlay) targets.push("player");
    if (hasEditableRows) {
        targets.push("filename", "overwrite");
        for (const f of META_FIELDS) if (f.editable) targets.push(fieldTarget(f));
    }
    if (compiled) targets.push("output");
    const current = targets.includes(cursor) ? cursor : (targets[0] ?? "");

    // Functional update: several wheel notches can arrive before the next render, and each must count.
    function moveCursor(delta: number) {
        setCursor((prev) => {
            const from = targets.includes(prev) ? prev : (targets[0] ?? "");
            return targets[Math.max(0, Math.min(targets.length - 1, targets.indexOf(from) + delta))] ?? prev;
        });
    }

    // Wheeling over the pane moves the cursor (and with it the window), like the other panels' lists.
    const rootRef = useRef<DOMElement>(null);
    useWheelTarget(rootRef, (delta) => {
        if (!isDiffMode && !isEditing) moveCursor(delta);
    });

    // ── Editing ───────────────────────────────────────────────────────────────

    const defaultFilename = compiled ? computeOutputFilename(compiled) : "";
    const currentFilename = compiled ? computeOutputFilename(compiled, filenameOverride) : "";

    function isOverridden(target: string): boolean {
        if (target === "output") return isOutputOverridden;
        if (target === "filename") return filenameOverride !== undefined;
        const field = findField(target);
        return field ? overrides[field.key as keyof MetadataOverrides] !== undefined : false;
    }

    function textOf(target: string): string {
        if (target === "output") return outputDir;
        if (target === "filename") return currentFilename;
        const field = findField(target);
        const value = field && compiled ? field.getCompiledValue(compiled) : "";
        return value === "—" ? "" : value;
    }

    /** Applies typed or pasted text to `target`; returns why it was refused, or null once applied. */
    function applyText(target: string, value: string): string | null {
        if (target === "output") {
            if (value.trim() === "") {
                onChangeOutputDir(undefined);
                return null;
            }
            const cleaned = cleanOutputDir(value);
            if (!cleaned) return "Not a valid absolute folder path";
            // Picking the Settings folder again just drops the override.
            onChangeOutputDir(isSameDir(cleaned, defaultOutputDir) ? undefined : cleaned);
            return null;
        }
        if (target === "filename") {
            if (value.trim() === "") {
                onChangeFilename(undefined);
                return null;
            }
            const cleaned = cleanOutputFilename(value);
            if (!cleaned) return "Not a valid file name";
            onChangeFilename(cleaned === defaultFilename ? undefined : cleaned);
            return null;
        }
        const field = findField(target);
        if (!field) return null;
        const key = field.key as keyof MetadataOverrides;
        if (value.trim() === "") {
            // Emptying a field takes the edit back; the value falls to what the sources say.
            const rest = { ...overrides };
            delete rest[key];
            onOverridesChange(rest);
            return null;
        }
        if (value === textOf(target)) return null;
        const parsed = field.parseValue ? field.parseValue(value) : value;
        if (parsed === null) return "Invalid value";
        onOverridesChange({ ...overrides, [key]: parsed });
        return null;
    }

    /** What Enter (or a second click) does on a row: flip the switch, or start typing in it. */
    function activate(target: string) {
        if (target === "overwrite") onChangeOverwriteTags(!overwriteTags);
        else startEditing(target);
    }

    /** A click on a row: it selects it (and focuses the pane); a click on an already selected text row, or on the switch, activates it. */
    function clickRow(target: string) {
        if (isDiffMode || edit?.target === target) return;
        if (isEditing) stopEditing();
        onFocusPane();
        setCursor(target);
        // A switch has nothing to select first: one click flips it. Text rows need a second click to edit.
        if (target === "overwrite" || (isActive && current === target)) activate(target);
    }

    function startEditing(target: string) {
        // The extension is fixed, so the file name is edited without it.
        const draft = target === "filename" ? stripOutputExtension(currentFilename) : textOf(target);
        setEdit({ target, draft, error: null, inputKey: 0 });
        setIsEditingField(true);
    }

    function stopEditing() {
        setEdit(null);
        setIsEditingField(false);
    }

    function handleDraftChange(next: string) {
        if (!edit) return;
        const chunk = insertedText(edit.draft, next);
        if (replacesDraft(edit.target, chunk)) {
            const cleanedPath = edit.target === "output" ? cleanOutputDir(chunk) : cleanOutputFilename(chunk);
            const cleaned = cleanedPath && edit.target === "filename" ? stripOutputExtension(cleanedPath) : cleanedPath;
            if (cleaned) {
                // Remounting the input puts its cursor at the end of the rewritten draft.
                setEdit({ ...edit, draft: cleaned, error: null, inputKey: edit.inputKey + 1 });
                return;
            }
        }
        setEdit({ ...edit, draft: next, error: null });
    }

    function handleDraftSubmit(value: string) {
        if (!edit) return;
        const error = applyText(edit.target, value);
        if (error) setEdit({ ...edit, error });
        else stopEditing();
    }

    function pasteIntoCurrent() {
        let text = "";
        try {
            text = clipboard.readSync();
        } catch {
            /* clipboard unavailable */
        }
        if (!text.trim()) {
            setNotice("The clipboard is empty");
            return;
        }
        const error = applyText(current, text);
        if (error) setNotice(`Clipboard: ${error.toLowerCase()}`);
    }

    function copyCurrent() {
        const text = textOf(current);
        if (!text) return;
        try {
            clipboard.writeSync(text);
            setNotice("Copied");
        } catch {
            setNotice("Could not reach the clipboard");
        }
    }

    function resetCurrent() {
        if (!isOverridden(current)) return;
        if (current === "output") onChangeOutputDir(undefined);
        else if (current === "filename") onChangeFilename(undefined);
        else {
            const field = findField(current);
            if (!field) return;
            const rest = { ...overrides };
            delete rest[field.key as keyof MetadataOverrides];
            onOverridesChange(rest);
        }
    }

    const isTextTarget = current === "output" || current === "filename" || current.startsWith("field:");
    const rowTitle =
        current === "output"
            ? "Output folder"
            : current === "filename"
              ? "File name"
              : current === "overwrite"
                ? "Tags"
                : current.startsWith("field:")
                  ? (findField(current)?.label ?? "Metadata")
                  : "Download";

    const canSave = canPlay && !isSaving;
    const saveLabel = source?.savedFile ? "Update" : "Save";

    useShortcuts({
        id: "downloadSourceDetail",
        isActive,
        priority: 200,
        shortcuts: [
            {
                id: "downloadSourceDetail.confirm",
                defaultShortcut: { key: "return" },
                label: isDiffMode
                    ? "Confirm"
                    : isEditing
                      ? "Apply"
                      : current === "overwrite"
                        ? "Toggle"
                        : current === "filename"
                          ? "Rename"
                          : current === "output"
                            ? "Edit folder"
                            : current.startsWith("field:")
                              ? "Edit"
                              : saveLabel,
                handler: () => {
                    // While typing, Enter belongs to the text input (it applies the draft).
                    if (isEditing) return;
                    if (isDiffMode) {
                        onConfirmDiff();
                        return;
                    }
                    if (current === "overwrite" || isTextTarget) activate(current);
                    else if (canSave) onSave();
                },
            },
            {
                id: "downloadSourceDetail.save",
                defaultShortcut: { input: "s" },
                label: saveLabel,
                handler: () => {
                    if (!isDiffMode && !isEditing && canSave) onSave();
                },
            },
            {
                id: "downloadSourceDetail.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (isEditing) stopEditing();
                    else if (isDiffMode) onCancelDiff();
                    else if (targets[0] && current !== targets[0]) setCursor(targets[0]);
                },
            },
            {
                id: "downloadSourceDetail.back",
                defaultShortcut: { key: "leftArrow" },
                label: "Back",
                handler: () => {
                    if (!isDiffMode && !isEditing) onInnerFocusSwitch();
                },
            },
            {
                id: "downloadSourceDetail.down",
                defaultShortcut: { key: "downArrow" },
                label: "Next",
                handler: () => {
                    if (!isDiffMode && !isEditing) moveCursor(1);
                },
            },
            {
                id: "downloadSourceDetail.up",
                defaultShortcut: { key: "upArrow" },
                label: "Prev",
                handler: () => {
                    if (!isDiffMode && !isEditing) moveCursor(-1);
                },
            },
            {
                id: "downloadSourceDetail.paste",
                defaultShortcut: { input: "v", ctrl: true },
                label: "Paste",
                handler: () => {
                    if (!isDiffMode && !isEditing && isTextTarget) pasteIntoCurrent();
                },
            },
            {
                id: "downloadSourceDetail.copy",
                defaultShortcut: { input: "c", ctrl: true },
                label: "Copy",
                handler: () => {
                    if (!isDiffMode && !isEditing && isTextTarget) copyCurrent();
                },
            },
            {
                id: "downloadSourceDetail.reset",
                defaultShortcut: { key: "delete" },
                label: "Reset",
                handler: () => {
                    if (!isDiffMode && !isEditing) resetCurrent();
                },
            },
            {
                id: "downloadSourceDetail.playPause",
                defaultShortcut: { input: " " },
                label: isPlaying ? "Pause" : isPaused ? "Resume" : "Play",
                handler: () => {
                    if (isDiffMode || isEditing) return;
                    togglePlayback();
                },
            },
            {
                id: "downloadSourceDetail.seekBack",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Seek -5s",
                handler: () => {
                    if (isDiffMode || isEditing) return;
                    const player = getInstance();
                    const status = player.getStatus();
                    if (status.filePath === currentFilePath && (status.isPlaying || status.isPaused)) {
                        player.seekMs(Math.max(0, status.positionMs - 5000)).catch(() => {});
                    }
                },
            },
            {
                id: "downloadSourceDetail.seekFwd",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Seek +5s",
                handler: () => {
                    if (isDiffMode || isEditing) return;
                    const player = getInstance();
                    const status = player.getStatus();
                    if (status.filePath === currentFilePath && (status.isPlaying || status.isPaused)) {
                        player.seekMs(Math.min(status.durationMs, status.positionMs + 5000)).catch(() => {});
                    }
                },
            },
            {
                id: "downloadSourceDetail.relocate",
                defaultShortcut: { input: "f", ctrl: true },
                label: "Relocate",
                handler: () => {
                    if (!isDiffMode && !isEditing && fileNotFoundNow) onRelocateFile();
                },
            },
        ],
        hintLines: isDiffMode
            ? [
                  {
                      id: "downloadSourceDetail.line.diff",
                      left: { type: "text", value: "Diff", bold: true },
                      shortcutIds: ["downloadSourceDetail.confirm", "downloadSourceDetail.cancel"],
                  },
              ]
            : isEditing
              ? [
                    {
                        id: "downloadSourceDetail.line.edit",
                        left: { type: "text", value: rowTitle, bold: true },
                        shortcutIds: ["downloadSourceDetail.confirm", "downloadSourceDetail.cancel"],
                    },
                ]
              : [
                    {
                        id: "downloadSourceDetail.line.row",
                        left: { type: "text", value: rowTitle, bold: true },
                        shortcutIds: [
                            ...(current === "player"
                                ? [
                                      ...(canPlay ? ["downloadSourceDetail.playPause"] : []),
                                      ...(isPlaying || isPaused
                                          ? ["downloadSourceDetail.seekBack", "downloadSourceDetail.seekFwd"]
                                          : []),
                                      ...(fileNotFoundNow ? ["downloadSourceDetail.relocate"] : []),
                                  ]
                                : current === "overwrite"
                                  ? ["downloadSourceDetail.confirm"]
                                  : [
                                        "downloadSourceDetail.confirm",
                                        "downloadSourceDetail.paste",
                                        "downloadSourceDetail.copy",
                                        ...(isOverridden(current) ? ["downloadSourceDetail.reset"] : []),
                                    ]),
                            ...(canSave ? ["downloadSourceDetail.save"] : []),
                            "downloadSourceDetail.up",
                            "downloadSourceDetail.down",
                        ],
                    },
                ],
    });

    if (isDiffMode && savedSource && pendingSource) {
        return (
            <DiffView
                savedSource={savedSource}
                pendingSource={pendingSource}
                compiled={compiled}
                outputDir={outputDir}
                newFilename={previewFilename}
                diffKind={diffKind}
                isActive={isActive}
                width={width}
                height={height}
            />
        );
    }

    if (!source) return null;

    // The file isn't on disk yet (still downloading, queued, or failed). Don't show the
    // "NEW FILE" preview — there's nothing to preview/save. Show the current state instead.
    if (!source.localFile && !source.savedFile) {
        return <DownloadInProgress source={source} width={width} height={height} />;
    }

    const isSaved = !!source.savedFile;
    const borderColor = isSaved ? theme.text.primary : theme.status.success;
    const headerColor = isSaved ? theme.text.primary : theme.status.success;

    const outputFileExists = !isSaved && compiled !== null && fs.existsSync(path.join(outputDir, currentFilename));

    const headerLabel = isSaved ? "FILE ON DISK" : "NEW FILE";
    const innerW = width - 2;
    const dashes = Math.max(0, innerW - headerLabel.length - 2);
    const leftD = Math.floor(dashes / 2);
    const rightD = dashes - leftD + 1;
    const borderLeft = `┌${"─".repeat(leftD)} `;
    const borderRight = ` ${"─".repeat(rightD)}┐`;

    // The output folder block under the file panel, drawn like its header.
    const outputFocused = isActive && current === "output";
    const outputBorderColor = outputFocused ? theme.text.active : theme.text.secondary;
    const outputLabel = "OUTPUT FOLDER";
    const outputDashes = Math.max(0, innerW - outputLabel.length - 2);
    const outputLeftD = Math.floor(outputDashes / 2);
    const outputBorderLeft = `┌${"─".repeat(outputLeftD)} `;
    const outputBorderRight = ` ${"─".repeat(outputDashes - outputLeftD + 1)}┐`;
    const outputFolderExists = fs.existsSync(outputDir);
    const outputEdit = edit?.target === "output" ? edit : null;

    const fileNotFound = source.localFile?.state === "not_found";
    const sourceDurationMs = source.fileInfo?.durationMs ?? source.track.duration ?? 0;
    const displayDurationMs = durationMs > 0 ? durationMs : sourceDurationMs;
    const sizeText = source.fileInfo ? formatBytes(source.fileInfo.sizeBytes) : "—";
    const provenance = getProvenanceDisplay(source.fileInfo);
    const formatLabel = provenance.badge || (source.fileInfo?.format ?? "flac").toUpperCase();
    const provenanceColor = provenance.tone === "warning" ? theme.status.warning : theme.status.success;
    const embeddedTags = source.fileInfo?.embeddedTags ?? {};
    const otherTagKeys = Object.keys(embeddedTags)
        .map((k) => k.toUpperCase())
        .filter((k) => !PRIORITY_TAGS.includes(k));

    const dlProvider = providerDisplayRegistry.get(source.provider);
    const sourceUri = source.track.uri ?? `${source.track.platform.toUpperCase()}::TRACK::${source.track.id}`;

    /** The in-place text input for `target`, when it is the one being edited. */
    const editFor = (target: string): FocusRowEdit | undefined =>
        edit?.target === target
            ? {
                  draft: edit.draft,
                  error: edit.error,
                  inputKey: edit.inputKey,
                  onChange: handleDraftChange,
                  onSubmit: handleDraftSubmit,
                  suffix: target === "filename" ? OUTPUT_EXTENSION : undefined,
              }
            : undefined;

    // ── Rows ──────────────────────────────────────────────────────────────────
    // Every row is one terminal row tall (the player is two), so the pane can show a window of them.

    const rows: DetailRowSpec[] = [];

    if (outputFileExists) {
        rows.push({
            key: "exists",
            node: (
                <Box paddingX={1} flexShrink={0}>
                    <Text color={theme.status.warning} bold wrap="truncate-end">
                        △ A file already exists here: saving overwrites it
                    </Text>
                </Box>
            ),
        });
    }

    if (canPlay) {
        rows.push({
            key: "player",
            height: 2,
            node: (
                <PlaybackBar
                    positionMs={positionMs}
                    durationMs={displayDurationMs}
                    width={innerW}
                    isPlaying={isPlaying}
                    isPaused={isPaused}
                    isFocused={isActive && current === "player"}
                    onToggle={() => {
                        onFocusPane();
                        setCursor("player");
                        togglePlayback();
                    }}
                    onSeek={(fraction) => {
                        onFocusPane();
                        setCursor("player");
                        seekToFraction(fraction);
                    }}
                />
            ),
        });
    }

    rows.push({
        key: "source",
        node: (
            <Box paddingX={1} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary}>{"SOURCE  "}</Text>
                </Box>
                <Box flexShrink={0}>
                    <Text color={dlProvider.color}>{dlProvider.label}</Text>
                </Box>
                {source.providerDetail && (
                    <Box flexShrink={1} maxWidth={20} overflow="hidden">
                        <Text color={theme.text.secondary} dimColor wrap="truncate-end">
                            {` (${source.providerDetail})`}
                        </Text>
                    </Box>
                )}
                <Box flexShrink={0}>
                    <Text color={theme.text.secondary}>{" > "}</Text>
                </Box>
                <Uri uri={sourceUri} platform={source.track.platform} noPaddingX />
            </Box>
        ),
    });
    rows.push({ key: "gap-source", node: <Box height={1} flexShrink={0} /> });

    if (fileNotFound) {
        rows.push(
            {
                key: "missing",
                node: (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.status.warning}>△ File not found</Text>
                    </Box>
                ),
            },
            {
                key: "missing-path",
                node: (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.text.secondary} dimColor wrap="truncate-end">
                            Last known: {source.localFile?.path ?? "—"}
                        </Text>
                    </Box>
                ),
            },
            { key: "gap-missing", node: <Box height={1} flexShrink={0} /> },
            {
                key: "missing-hint",
                node: (
                    <Box paddingX={1} flexShrink={0}>
                        <Hint shortcutId="downloadSourceDetail.relocate" label="Relocate file" />
                    </Box>
                ),
            }
        );
    } else {
        const clickable = (target: string, node: React.ReactNode) => (
            <ClickableBox onClick={() => clickRow(target)}>{node}</ClickableBox>
        );
        const editedBadge = { text: "EDITED", color: theme.field.overridden, italic: true, strong: true };

        // The file itself: its name (editable), format, quality, size and length.
        rows.push({ key: "attr-header", node: <AttributesHeader label="File attributes" /> });
        if (compiled) {
            rows.push({
                key: "filename",
                node: clickable(
                    "filename",
                    <FocusRow
                        variant="attribute"
                        label="File"
                        value={currentFilename}
                        valueColor={filenameOverride ? theme.field.overridden : undefined}
                        isFocused={isActive && current === "filename"}
                        edit={editFor("filename")}
                        badge={filenameOverride ? editedBadge : undefined}
                    />
                ),
            });
        }
        rows.push({
            key: "format",
            node: (
                <DetailRow
                    variant="attribute"
                    label="Format"
                    value={formatLabel}
                    valueColor={provenance.badge ? provenanceColor : undefined}
                />
            ),
        });
        if (provenance.detail) {
            rows.push({
                key: "quality",
                node: (
                    <DetailRow
                        variant="attribute"
                        label="Quality"
                        value={provenance.detail}
                        valueColor={theme.status.warning}
                    />
                ),
            });
        }
        rows.push(
            { key: "size", node: <DetailRow variant="attribute" label="Size" value={sizeText} /> },
            {
                key: "duration",
                node: <DetailRow variant="attribute" label="Duration" value={formatDuration(sourceDurationMs)} />,
            },
            { key: "gap-attr", node: <Box height={1} flexShrink={0} /> }
        );

        // What saving writes into the file's tags.
        if (compiled) {
            rows.push(
                {
                    key: "overwrite",
                    node: clickable(
                        "overwrite",
                        <FocusRow
                            label="Tags"
                            value={overwriteTags ? "☒ Overwrite with compiled metadata" : "☐ Keep the file's own tags"}
                            valueColor={overwriteTags ? theme.status.success : theme.text.secondary}
                            isFocused={isActive && current === "overwrite"}
                        />
                    ),
                },
                { key: "gap-overwrite", node: <Box height={1} flexShrink={0} /> }
            );
            for (const field of META_FIELDS) {
                const target = fieldTarget(field);
                const value = field.getCompiledValue(compiled);
                const edited = isOverridden(target);
                const attribution = attributionBadge(compiled.attribution[field.key], theme);
                const row = (
                    <FocusRow
                        label={field.label}
                        value={value}
                        valueColor={
                            value === "—" ? theme.field.missing : edited ? theme.field.overridden : theme.field.normal
                        }
                        dim={!overwriteTags}
                        isFocused={isActive && current === target}
                        edit={editFor(target)}
                        badge={edited ? editedBadge : attribution.text ? attribution : undefined}
                    />
                );
                rows.push({ key: target, node: field.editable ? clickable(target, row) : row });
            }
            rows.push({ key: "gap-fields", node: <Box height={1} flexShrink={0} /> });
        }

        rows.push({ key: "divider-tags", node: <SectionDivider label="Embedded Tags" width={innerW} /> });
        for (const tag of [...PRIORITY_TAGS, ...otherTagKeys]) {
            rows.push({ key: `tag:${tag}`, node: <DetailRow label={tag} value={tagValue(embeddedTags, tag)} /> });
        }
    }

    if (source.savedFile) {
        rows.push(
            { key: "gap-saved", node: <Box height={1} flexShrink={0} /> },
            { key: "divider-saved", node: <SectionDivider label="Saved" width={innerW} /> },
            { key: "saved-path", node: <DetailRow label="Path" value={source.savedFile.path} /> },
            { key: "saved-at", node: <DetailRow label="Saved at" value={formatDate(source.savedFile.savedAt)} /> }
        );
    }

    // The output folder is not one of the rows: while the cursor is on it, the rows stay where the last one left them.
    const lastRowTarget = [...targets].reverse().find((t) => t !== "output");
    const focusRowKey = current === "output" ? lastRowTarget : current;
    const visibleRows =
        viewport.hasMeasured && viewport.height > 0 ? windowRows(rows, focusRowKey, viewport.height) : rows;

    return (
        <Box ref={rootRef} flexDirection="column" width={width} height={height} overflow="hidden">
            <Box flexDirection="column" height={1} flexShrink={0} overflow="hidden">
                <Box flexDirection="row">
                    <Text color={borderColor}>{borderLeft}</Text>
                    <Text color={headerColor}>{headerLabel}</Text>
                    <Text color={borderColor}>{borderRight}</Text>
                </Box>
            </Box>

            <Box
                flexDirection="column"
                flexGrow={1}
                overflow="hidden"
                borderStyle="single"
                borderColor={borderColor}
                borderBackgroundColor={theme.ui.background}
                borderTop={false}
            >
                <Box ref={viewportRef} flexDirection="column" flexGrow={1} overflow="hidden">
                    {visibleRows.map((row) => (
                        <React.Fragment key={row.key}>{row.node}</React.Fragment>
                    ))}
                </Box>
            </Box>

            {compiled && (
                <ClickableBox onClick={() => clickRow("output")}>
                    <Box flexDirection="column" flexShrink={0} width={width}>
                        <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
                            <Text color={outputBorderColor}>{outputBorderLeft}</Text>
                            <Text color={outputBorderColor} bold={outputFocused}>
                                {outputLabel}
                            </Text>
                            <Text color={outputBorderColor}>{outputBorderRight}</Text>
                        </Box>
                        <Box
                            flexDirection="column"
                            flexShrink={0}
                            paddingX={1}
                            borderStyle="single"
                            borderColor={outputBorderColor}
                            borderBackgroundColor={theme.ui.background}
                            borderTop={false}
                        >
                            {outputEdit ? (
                                <Box flexDirection="column" flexShrink={0}>
                                    <TextInput
                                        key={outputEdit.inputKey}
                                        value={outputEdit.draft}
                                        onChange={handleDraftChange}
                                        onSubmit={handleDraftSubmit}
                                    />
                                    <Text
                                        color={outputEdit.error ? theme.field.error : theme.text.secondary}
                                        dimColor={!outputEdit.error}
                                    >
                                        {outputEdit.error
                                            ? `✗ ${outputEdit.error}`
                                            : "Paste or type a folder · a file name or quotes are removed"}
                                    </Text>
                                </Box>
                            ) : (
                                <Box flexDirection="column" flexShrink={0}>
                                    {/* Wrapped, never truncated: the whole path has to be readable. */}
                                    <Text wrap="wrap" underline={outputFocused}>
                                        <Text color={theme.text.secondary}>{outputDir + path.sep}</Text>
                                        <Text color={theme.text.primary}>{currentFilename}</Text>
                                    </Text>
                                    <Text
                                        color={
                                            notice
                                                ? theme.status.warning
                                                : isOutputOverridden
                                                  ? theme.field.overridden
                                                  : theme.text.secondary
                                        }
                                        dimColor={!notice && !isOutputOverridden}
                                        wrap="wrap"
                                    >
                                        {notice ??
                                            (isOutputOverridden
                                                ? "Custom folder for this track"
                                                : "Default folder (Settings)") +
                                                (outputFolderExists ? "" : " · will be created")}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </ClickableBox>
            )}
        </Box>
    );
};
