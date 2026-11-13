import React, { useState, useEffect, useRef, type RefObject } from "react";
import wrapAnsi from "wrap-ansi";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import clipboard from "clipboardy";
import * as path from "path";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { useFileExists } from "#hooks/useFileExists";
import { useTheme } from "#base/themeContext";
import { type MetadataOverrides, type TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { type CompiledMetadata, type MusicBrainzIds } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { FIELDS, type FieldDef, compiledFieldValues } from "#flows/musicDownloadFlow/utils/metadataFields";
import { diskFieldValues } from "#flows/musicDownloadFlow/utils/diskTagValues";
import { readTags } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { MUSICBRAINZ_TAG_FIELDS, hasMusicBrainzTags } from "#flows/musicDownloadFlow/utils/musicBrainzTagFields";
import {
    computeOutputFilename,
    computeOutputPath,
    isOutputPathTaken,
} from "#flows/musicDownloadFlow/utils/computeOutputPath";
import {
    cleanOutputDir,
    cleanOutputFilename,
    isSameDir,
    stripOutputExtension,
} from "#flows/musicDownloadFlow/utils/cleanOutputDir";
import { getProvenanceDisplay, getSavedFileDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { extensionOf, previewOutputExtension } from "#flows/musicDownloadFlow/utils/outputFormat";
import { getSaveSettings } from "#flows/musicDownloadFlow/saveSettings";
import { getInstance } from "#utils/mpvPlayer";
import { playableFilePath } from "#flows/musicDownloadFlow/utils/playableFile";
import { togglePlayback as toggleFilePlayback, seekFileToFraction } from "#utils/togglePlayback";
import { formatBytes, formatDate, tagValue } from "#components/SecondaryPanel/DownloadPanel/utils";
import { Uri } from "#components/SecondaryPanel/MetadataPanel/Uri";
import { attributionBadge } from "#components/SecondaryPanel/MetadataPanel/FieldRow";
import { useShortcuts } from "#hooks/useShortcuts";
import { Hint } from "#components/Hint";
import { PlaybackBar } from "../PlaybackBar";
import { useFilePlayback } from "../useFilePlayback";
import { DownloadInProgress } from "./DownloadInProgress";
import { DetailRow } from "./DetailRow";
import { DiffCell, SourceCell, COMPACT_LABEL_W } from "./DiffCell";
import { AttributesHeader, ClickableBox, FocusRow, type FocusRowEdit, editRowLines } from "./FocusRow";
import { ActionButton } from "./ActionButton";
import { musicBrainzTint } from "./musicBrainzTint";
import { OutputFolderBlock } from "./OutputFolderBlock";
import { PanelFrame } from "./PanelFrame";
import { windowRows, type WindowRow } from "./windowRows";
import { formatDuration } from "../../utils";

interface DownloadSourceDetailProps {
    source: TrackDownloadSource | null;
    savedSource: TrackDownloadSource | null;
    /** The saved file is no longer on disk (see `useFileExists`). */
    savedFileMissing: boolean;
    compiled: CompiledMetadata | null;
    /** `compiled` without the track's own edits. */
    baseCompiled: CompiledMetadata | null;
    /** The track's own metadata edits (the same ones the Metadata tab makes). */
    overrides: MetadataOverrides;
    /** Folder this track will be saved to: the per-track override when set, else `defaultOutputDir`. */
    outputDir: string;
    /** Folder from Settings, used when the track has no override of its own. */
    defaultOutputDir: string;
    isOutputOverridden: boolean;
    /** Name chosen for this track instead of "Artist - Title"; undefined when it has none. */
    filenameOverride: string | undefined;
    /** Whether saving writes the compiled metadata into the file's tags. */
    overwriteTags: boolean;
    /** The MusicBrainz ids saving would write (undefined: nothing was matched, or the verdict is out of date). */
    musicBrainzIds: MusicBrainzIds | undefined;
    /** Whether saving writes `musicBrainzIds` into the tags: the track's own choice, else Settings → MusicBrainz. */
    includeMusicBrainzTags: boolean;
    /**
     * A change is pending on a track that is already saved: show the saved file (OLD, play only) next to
     * `pendingSource` (NEW, the same interactive pane as ever) instead of `source`.
     */
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
    /** `undefined` goes back to the "Artist - Title" name. */
    onChangeFilename: (filename: string | undefined) => void;
    onChangeOverwriteTags: (overwrite: boolean) => void;
    onChangeIncludeMusicBrainzTags: (include: boolean) => void;
    onOverridesChange: (overrides: MetadataOverrides) => void;
    setIsEditingField: (editing: boolean) => void;
    /** A click landed in this pane: give it keyboard focus. */
    onFocusPane: () => void;
    /** Shown in place of the pane when there is no `source` (e.g. the cursor is on a provider's header). */
    emptyState?: React.ReactNode;
}

const PRIORITY_TAGS = ["TITLE", "ARTIST", "ALBUM", "DATE", "TRACKNUMBER", "ISRC", "BPM", "KEY"];

// The file's own duration is its own row; the compiled duration is not written to the tags.
const META_FIELDS = FIELDS.filter((f) => f.key !== "duration");
// The label column of the MusicBrainz ids: wide enough for "ALB. ARTIST".
const MUSICBRAINZ_LABEL_W = 11;
// The rows that are a switch: one click or Enter flips them, there is nothing to type.
const isSwitchTarget = (target: string) => target === "overwrite" || target === "mbtags";
const fieldTarget = (f: FieldDef) => `field:${f.key}`;
const findField = (target: string) => META_FIELDS.find((f) => fieldTarget(f) === target);

// How long a one-line message under the output path ("Folder copied"…) stays visible.
const NOTICE_MS = 3000;

// The arrow column between the OLD and NEW panels.
const ARROW_W = 3;

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

const blankRow = (height = 1) => <Box height={height} flexShrink={0} />;

/**
 * One row of the pane. `node` is what the (NEW) pane shows; in the side-by-side view `old` is the read-only
 * counterpart in the OLD panel (blank when the old version has nothing to compare) and `changed` puts an
 * arrow between the two.
 */
interface DetailRowSpec extends WindowRow {
    node: React.ReactNode;
    old?: React.ReactNode;
    changed?: boolean;
}

interface EditState {
    /** What is being edited: a `field:<key>`, "filename" or "output". */
    target: string;
    draft: string;
    error: string | null;
    inputKey: number;
}

export const DownloadSourceDetail: React.FC<DownloadSourceDetailProps> = ({
    source: listSource,
    savedSource,
    savedFileMissing,
    compiled,
    baseCompiled,
    overrides,
    outputDir,
    defaultOutputDir,
    isOutputOverridden,
    filenameOverride,
    overwriteTags,
    musicBrainzIds,
    includeMusicBrainzTags,
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
    onChangeIncludeMusicBrainzTags,
    onOverridesChange,
    setIsEditingField,
    onFocusPane,
    emptyState,
}) => {
    const theme = useTheme();
    // Looked up off the UI thread (and again every few seconds), not with `existsSync` on every render. Until the
    // first answer the folder is assumed to be there, so no warning flashes up.
    const folderExists = useFileExists(outputDir) !== false;

    // Side by side: the saved file (OLD) next to what it would become (NEW). Everything below that says
    // "source" is the NEW side, so the pane is the very same one in both modes.
    const oldSource = isDiffMode && pendingSource && savedSource?.savedFile ? savedSource : null;
    const oldPath = oldSource?.savedFile?.path ?? null;
    const compare = oldSource !== null;

    // What the OLD file really holds. Read from the disk: what was recorded when it was saved can be missing
    // (older saves, or tags that were left alone) and the file may have been changed since.
    const [diskTags, setDiskTags] = useState<{
        path: string;
        values: Record<string, string>;
        tags: Record<string, string | string[]>;
    } | null>(null);
    const savedAt = oldSource?.savedFile?.savedAt?.toString();
    useEffect(() => {
        if (!oldPath) return;
        let current = true;
        readTags(oldPath, extensionOf(oldPath))
            .then((tags) => {
                if (current) setDiskTags({ path: oldPath, values: diskFieldValues(tags), tags });
            })
            .catch(() => {
                // Unreadable or gone: the recorded values stand in.
            });
        return () => {
            current = false;
        };
    }, [oldPath, savedAt]);
    const source = compare ? pendingSource : listSource;

    // The tags the saved file holds right now. The saved row's `fileInfo` is the one of the download it was made
    // from, so it cannot tell what was really written (the MusicBrainz ids, above all): the file is read.
    const savedPath = !compare ? (listSource?.savedFile?.path ?? null) : null;
    const savedFileAt = listSource?.savedFile?.savedAt?.toString();
    const [savedDiskTags, setSavedDiskTags] = useState<{
        path: string;
        tags: Record<string, string | string[]>;
    } | null>(null);
    useEffect(() => {
        if (!savedPath) return;
        let current = true;
        readTags(savedPath, extensionOf(savedPath))
            .then((tags) => {
                if (current) setSavedDiskTags({ path: savedPath, tags });
            })
            .catch(() => {
                // Unreadable or gone: the section just stays empty.
            });
        return () => {
            current = false;
        };
    }, [savedPath, savedFileAt]);

    // Where the cursor is: "player", "overwrite", "mbtags", a `field:<key>`, "filename" or "output".
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
    // Set by a click that is about to focus the pane: the clicked row, not the entry point, gets the cursor.
    const [clickedIn, setClickedIn] = useState(false);
    if (prevIsActive !== isActive) {
        setPrevIsActive(isActive);
        setClickedIn(false);
        if (!isActive) setEdit(null);
        // Side by side, the OLD version is the first one you meet coming from the list on its left.
        else if (compare && !clickedIn) setCursor("oldPlayer");
    }

    /** Focuses the pane for a click. */
    function focusPane() {
        if (!isActive) setClickedIn(true);
        onFocusPane();
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

    // ── Playback ──────────────────────────────────────────────────────────────
    // Playback is intentionally NOT stopped when this panel switches file or unmounts: music
    // keeps playing in the background while you move between tasks and tabs (the playing task
    // is flagged in the task list, and the player is the app-wide singleton).

    // The temporary copy, or the saved file once that copy has been cleaned up.
    const currentFilePath = source ? playableFilePath(source) : null;
    const newPlayback = useFilePlayback(currentFilePath);
    const oldPlayback = useFilePlayback(oldPath);

    // The saved file (the pinned row) is gone from the disk: nothing to play, edit or update, only to relocate.
    const savedGone = !!source?.savedFile && savedFileMissing;
    const canPlay = currentFilePath !== null && !savedGone;
    // Shared by the Space shortcut and a click on the playback bar. Only a file that is already
    // loaded can be paused; starting one needs it to be on disk.
    const togglePlayback = () => {
        if (!currentFilePath) return;
        const status = getInstance().getStatus();
        const isLoaded = status.filePath === currentFilePath && (status.isPlaying || status.isPaused);
        if (isLoaded || canPlay) toggleFilePlayback(currentFilePath);
    };
    const seekToFraction = (fraction: number) => {
        if (!canPlay || !currentFilePath) return;
        seekFileToFraction(currentFilePath, fraction, source?.fileInfo?.durationMs ?? source?.track.duration ?? 0);
    };
    // A saved source whose temporary copy is gone (cleaned up) is not lost: its saved file is what is edited.
    const fileNotFoundNow = (source?.localFile?.state === "not_found" && !source.savedFile) || savedGone;

    /** Seeks by `deltaMs` in whichever of the two files is loaded in the player. */
    function seekBy(deltaMs: number) {
        const player = getInstance();
        const status = player.getStatus();
        const loaded = status.filePath !== null && (status.filePath === currentFilePath || status.filePath === oldPath);
        if (loaded && (status.isPlaying || status.isPaused)) {
            player.seekMs(Math.max(0, Math.min(status.durationMs, status.positionMs + deltaMs))).catch(() => {});
        }
    }

    // ── Cursor ────────────────────────────────────────────────────────────────

    // Everything the cursor can land on, in the order it appears on screen. The OLD side is never one of them.
    const hasEditableRows = !!source && (!!source.localFile || !!source.savedFile) && !fileNotFoundNow && !!compiled;
    // The MusicBrainz block: the switch and the ids (side by side, those of the old file next to the new ones).
    const showMusicBrainz = hasEditableRows && !!musicBrainzIds;
    const targets: string[] = [];
    // Side by side, the OLD file's playback bar is reached with ← and → (it is on the same row as the NEW one).
    if (compare && oldPath) targets.push("oldPlayer");
    if (canPlay) targets.push("player");
    if (hasEditableRows) {
        targets.push("filename", "overwrite");
        for (const f of META_FIELDS) if (f.editable) targets.push(fieldTarget(f));
        if (showMusicBrainz) targets.push("mbtags");
    }
    if (compiled) targets.push("output");
    const current = targets.includes(cursor) ? cursor : (targets[0] ?? "");

    // The last row the cursor was on. Selecting the output folder (which is not one of the rows) must not
    // scroll them, so the window keeps following this one meanwhile.
    const [rowFocus, setRowFocus] = useState(current);
    if (current !== "output" && rowFocus !== current) setRowFocus(current);

    // Functional update: several wheel notches can arrive before the next render, and each must count.
    function moveCursor(delta: number) {
        setCursor((prev) => {
            // The OLD bar shares its row with the NEW one: up/down only ever go between rows.
            const rowTargets = targets.filter((t) => t !== "oldPlayer");
            if (prev === "oldPlayer" && delta < 0) return prev;
            const from = rowTargets.includes(prev) ? prev : (rowTargets[0] ?? "");
            return rowTargets[Math.max(0, Math.min(rowTargets.length - 1, rowTargets.indexOf(from) + delta))] ?? prev;
        });
    }

    // Wheeling over the pane moves the cursor (and with it the window), like the other panels' lists.
    const rootRef = useRef<DOMElement>(null);
    useWheelTarget(rootRef, (delta) => {
        if (!isEditing) moveCursor(delta);
    });

    // ── Editing ───────────────────────────────────────────────────────────────

    // The extension is not typed by the user: it is the format the track will be saved in (Settings → Download),
    // or, when only the saved file is left (its download was cleaned up), the one it has. A saved file in another
    // format than the setting wants is made again from its download, so the name shows the new extension.
    const downloadPath = source?.localFile?.state === "found" ? source.localFile.path : undefined;
    const outputExt = previewOutputExtension(getSaveSettings(), downloadPath, source?.savedFile?.path);
    const defaultFilename = compiled ? computeOutputFilename(compiled, undefined, outputExt) : "";
    const currentFilename = compiled ? computeOutputFilename(compiled, filenameOverride, outputExt) : "";

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
            const cleaned = cleanOutputFilename(value, outputExt);
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
        // Typing back what the sources say is no edit at all: drop the override (and its EDITED mark).
        const sourceValue = baseCompiled ? field.getCompiledValue(baseCompiled) : undefined;
        if (value === (sourceValue === "—" ? "" : sourceValue)) {
            if (overrides[key] !== undefined) {
                const rest = { ...overrides };
                delete rest[key];
                onOverridesChange(rest);
            }
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
        else if (target === "mbtags") onChangeIncludeMusicBrainzTags(!includeMusicBrainzTags);
        else startEditing(target);
    }

    /** A click on a row: it selects it (and focuses the pane); a click on an already selected text row, or on the switch, activates it. */
    function clickRow(target: string) {
        if (edit?.target === target) return;
        if (isEditing) stopEditing();
        focusPane();
        setCursor(target);
        // A switch has nothing to select first: one click flips it. Text rows need a second click to edit.
        if (isSwitchTarget(target) || (isActive && current === target)) activate(target);
    }

    function startEditing(target: string) {
        // The extension is fixed, so the file name is edited without it.
        const draft = target === "filename" ? stripOutputExtension(currentFilename, outputExt) : textOf(target);
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
            const cleanedPath =
                edit.target === "output" ? cleanOutputDir(chunk) : cleanOutputFilename(chunk, outputExt);
            const cleaned =
                cleanedPath && edit.target === "filename" ? stripOutputExtension(cleanedPath, outputExt) : cleanedPath;
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
        current === "oldPlayer"
            ? "Old version"
            : current === "output"
              ? "Output folder"
              : current === "filename"
                ? "File name"
                : current === "overwrite"
                  ? "Tags"
                  : current === "mbtags"
                    ? "MusicBrainz tags"
                    : current.startsWith("field:")
                      ? (findField(current)?.label ?? "Metadata")
                      : "Download";

    const canSave = canPlay && !isSaving;
    const saveLabel = source?.savedFile ? "Update" : "Save";
    // What confirming does when the two versions are side by side.
    const diffConfirmLabel = diffKind === "metadata-change" ? "Save changes" : "Replace saved file";

    useShortcuts({
        id: "downloadSourceDetail",
        isActive,
        priority: 200,
        shortcuts: [
            {
                id: "downloadSourceDetail.confirm",
                defaultShortcut: { key: "return" },
                label: isEditing
                    ? "Apply"
                    : isSwitchTarget(current)
                      ? "Toggle"
                      : current === "filename"
                        ? "Rename"
                        : current === "output"
                          ? "Edit folder"
                          : current.startsWith("field:")
                            ? "Edit"
                            : compare
                              ? diffConfirmLabel
                              : saveLabel,
                handler: () => {
                    // While typing, Enter belongs to the text input (it applies the draft).
                    if (isEditing) return;
                    if (isSwitchTarget(current) || isTextTarget) activate(current);
                    else if (compare) onConfirmDiff();
                    else if (canSave) onSave();
                },
            },
            {
                id: "downloadSourceDetail.save",
                defaultShortcut: { input: "s" },
                label: compare ? diffConfirmLabel : saveLabel,
                handler: () => {
                    if (isEditing) return;
                    if (compare) onConfirmDiff();
                    else if (canSave) onSave();
                },
            },
            {
                id: "downloadSourceDetail.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (isEditing) stopEditing();
                    else if (compare) onCancelDiff();
                    else if (targets[0] && current !== targets[0]) setCursor(targets[0]);
                },
            },
            {
                id: "downloadSourceDetail.back",
                defaultShortcut: { key: "leftArrow" },
                label: "Back",
                handler: () => {
                    if (isEditing) return;
                    // Side by side the list is two panels away: NEW, then OLD, then the list.
                    if (compare && current !== "oldPlayer") setCursor("oldPlayer");
                    else onInnerFocusSwitch();
                },
            },
            {
                id: "downloadSourceDetail.forward",
                defaultShortcut: { key: "rightArrow" },
                label: "New version",
                handler: () => {
                    if (!isEditing && current === "oldPlayer") setCursor(canPlay ? "player" : (targets[1] ?? current));
                },
            },
            {
                id: "downloadSourceDetail.down",
                defaultShortcut: { key: "downArrow" },
                label: "Next",
                handler: () => {
                    if (!isEditing) moveCursor(1);
                },
            },
            {
                id: "downloadSourceDetail.up",
                defaultShortcut: { key: "upArrow" },
                label: "Prev",
                handler: () => {
                    if (!isEditing) moveCursor(-1);
                },
            },
            {
                id: "downloadSourceDetail.paste",
                defaultShortcut: { input: "v", ctrl: true },
                label: "Paste",
                handler: () => {
                    if (!isEditing && isTextTarget) pasteIntoCurrent();
                },
            },
            {
                id: "downloadSourceDetail.copy",
                defaultShortcut: { input: "c", ctrl: true },
                label: "Copy",
                handler: () => {
                    if (!isEditing && isTextTarget) copyCurrent();
                },
            },
            {
                id: "downloadSourceDetail.reset",
                defaultShortcut: { key: "delete" },
                label: "Reset",
                handler: () => {
                    if (!isEditing) resetCurrent();
                },
            },
            {
                id: "downloadSourceDetail.playPause",
                defaultShortcut: { input: " " },
                label: (current === "oldPlayer" ? oldPlayback : newPlayback).isPlaying
                    ? "Pause"
                    : (current === "oldPlayer" ? oldPlayback : newPlayback).isPaused
                      ? "Resume"
                      : "Play",
                handler: () => {
                    if (isEditing) return;
                    if (current === "oldPlayer" && oldPath) toggleFilePlayback(oldPath);
                    else togglePlayback();
                },
            },
            {
                id: "downloadSourceDetail.playOld",
                defaultShortcut: { input: "o" },
                label: oldPlayback.isPlaying ? "Pause old" : oldPlayback.isPaused ? "Resume old" : "Play old",
                handler: () => {
                    if (!isEditing && oldPath) toggleFilePlayback(oldPath);
                },
            },
            {
                id: "downloadSourceDetail.seekBack",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Seek -5s",
                handler: () => {
                    if (!isEditing) seekBy(-5000);
                },
            },
            {
                id: "downloadSourceDetail.seekFwd",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Seek +5s",
                handler: () => {
                    if (!isEditing) seekBy(5000);
                },
            },
            {
                id: "downloadSourceDetail.relocate",
                defaultShortcut: { input: "f", ctrl: true },
                label: "Relocate",
                handler: () => {
                    if (!isEditing && fileNotFoundNow) onRelocateFile();
                },
            },
        ],
        hintLines: isEditing
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
                          ...(current === "player" || current === "oldPlayer"
                              ? [
                                    ...(canPlay || current === "oldPlayer" ? ["downloadSourceDetail.playPause"] : []),
                                    ...(current === "oldPlayer" ? ["downloadSourceDetail.forward"] : []),
                                    ...(newPlayback.isPlaying ||
                                    newPlayback.isPaused ||
                                    oldPlayback.isPlaying ||
                                    oldPlayback.isPaused
                                        ? ["downloadSourceDetail.seekBack", "downloadSourceDetail.seekFwd"]
                                        : []),
                                ]
                              : isSwitchTarget(current)
                                ? ["downloadSourceDetail.confirm"]
                                : [
                                      "downloadSourceDetail.confirm",
                                      "downloadSourceDetail.paste",
                                      "downloadSourceDetail.copy",
                                      ...(isOverridden(current) ? ["downloadSourceDetail.reset"] : []),
                                  ]),
                          // Whatever row the cursor is on (a lost file leaves only the output folder to land on).
                          ...(fileNotFoundNow ? ["downloadSourceDetail.relocate"] : []),
                          ...(compare && current !== "oldPlayer" ? ["downloadSourceDetail.playOld"] : []),
                          ...(compare || canSave ? ["downloadSourceDetail.save"] : []),
                          ...(compare ? ["downloadSourceDetail.cancel"] : []),
                          "downloadSourceDetail.up",
                          "downloadSourceDetail.down",
                      ],
                  },
              ],
    });

    if (!source) return <>{emptyState ?? null}</>;

    // The file isn't on disk yet (still downloading, queued, or failed). Don't show the
    // "NEW FILE" preview — there's nothing to preview/save. Show the current state instead.
    if (!source.localFile && !source.savedFile) {
        return <DownloadInProgress source={source} width={width} height={height} />;
    }

    // ── Layout ────────────────────────────────────────────────────────────────

    const isSaved = !!source.savedFile && !compare;
    // The OLD version stays in view while typing: it is what the edit is compared against.
    const sideBySide = compare;
    const oldWidth = sideBySide ? Math.floor((width - ARROW_W) / 2) : 0;
    const panelWidth = sideBySide ? width - ARROW_W - oldWidth : width;
    const innerW = panelWidth - 2;
    const panelTitle = compare ? "NEW VERSION" : isSaved ? "FILE ON DISK" : "NEW FILE";
    const panelColor = compare || !isSaved ? theme.status.success : theme.text.primary;

    // When another file already has this name, saving replaces it (after asking). The file this track saved
    // (or the one this source replaces) is not "another file".
    const replacesExisting =
        compiled != null &&
        isOutputPathTaken(computeOutputPath(compiled, outputDir, filenameOverride, outputExt), [
            source.savedFile?.path,
            savedSource?.savedFile?.path,
        ]);
    const outputEdit = edit?.target === "output" ? edit : null;

    const fileNotFound = fileNotFoundNow;
    const sourceDurationMs = source.fileInfo?.durationMs ?? source.track.duration ?? 0;
    const displayDurationMs = newPlayback.durationMs > 0 ? newPlayback.durationMs : sourceDurationMs;
    // What the panel describes is the file the track will be (or is) saved as. When saving re-encodes the download,
    // that is not the download itself: the format and quality are worked out for the converted file, and its size
    // is unknown until it is written.
    const willConvert = !isSaved && !!downloadPath && extensionOf(downloadPath) !== outputExt;
    const savedConversion = isSaved ? source.savedFile?.converted : undefined;
    const provenance =
        isSaved || willConvert
            ? getSavedFileDisplay(source.fileInfo, isSaved ? savedConversion : { format: outputExt, sizeBytes: 0 })
            : getProvenanceDisplay(source.fileInfo);
    const sizeText = willConvert
        ? "—"
        : savedConversion
          ? formatBytes(savedConversion.sizeBytes)
          : source.fileInfo
            ? formatBytes(source.fileInfo.sizeBytes)
            : "—";
    const formatLabel = provenance.badge || (source.fileInfo?.format ?? "flac").toUpperCase();
    const provenanceColor = provenance.tone === "warning" ? theme.status.warning : theme.status.success;
    // A saved file shows what it holds now (nothing until it is read); a download, the tags it came with.
    const embeddedTags: Record<string, string | string[]> = isSaved
        ? savedDiskTags?.path === savedPath
            ? savedDiskTags.tags
            : {}
        : (source.fileInfo?.embeddedTags ?? {});
    const musicBrainzTagNames = MUSICBRAINZ_TAG_FIELDS.map((f) => f.tag);
    const otherTagKeys = Object.keys(embeddedTags)
        .map((k) => k.toUpperCase())
        .filter((k) => !PRIORITY_TAGS.includes(k) && !musicBrainzTagNames.includes(k));
    // The MusicBrainz ids have their own section. For a saved file it is always there: "—" says they were not written.
    const showEmbeddedMusicBrainz = isSaved || hasMusicBrainzTags(embeddedTags);
    // For a saved file, what its MusicBrainz tags say about the ids above, once the file has been read: the ids are
    // all in it ("in file"), it holds others or only some of them ("differs"), or none ("not in file").
    const musicBrainzFileState = (() => {
        if (!isSaved || !musicBrainzIds || savedDiskTags?.path !== savedPath) return undefined;
        const wanted = MUSICBRAINZ_TAG_FIELDS.map((f) => [
            f.idOf(musicBrainzIds),
            tagValue(embeddedTags, f.tag),
        ]).filter((pair): pair is [string, string] => !!pair[0]);
        if (wanted.every(([id, written]) => id === written)) return "in file" as const;
        return hasMusicBrainzTags(embeddedTags) ? ("differs" as const) : ("not in file" as const);
    })();

    const dlProvider = providerDisplayRegistry.get(source.provider);
    // The MusicBrainz rows' labels take its own (bright, so it reads on a dark background) colour.
    const musicBrainzColor = providerDisplayRegistry.get("musicBrainz").colorBright;
    // The colours of the MusicBrainz block, the way the "File attributes" block has its yellow ones.
    const musicBrainzColors = musicBrainzTint(theme);
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
                  suffix: target === "filename" ? `.${outputExt}` : undefined,
              }
            : undefined;

    // Side by side the panels are narrow: a tighter label column, no inset, no provider names.
    const labelWidth = compare ? COMPACT_LABEL_W : undefined;
    const inset = !compare;

    // Side by side, the switch label can be wider than the value column: it then breaks onto a second row.
    const tagsText = `${overwriteTags ? "☒" : "☐"} Use compiled metadata`;
    const tagsLines = compare
        ? wrapAnsi(tagsText, Math.max(1, panelWidth - 2 - 2 - 2 - COMPACT_LABEL_W - 1), { hard: true }).split("\n")
              .length
        : 1;

    /**
     * Rows the edited row takes. Side by side, a draft that wraps in the narrow panel grows the row, and the
     * OLD panel's matching row grows with it so the two stay level. Undefined: the usual single row.
     */
    const editHeight = (target: string): number | undefined => {
        if (!compare || edit?.target !== target) return undefined;
        // Panel width minus its border, the row's padding, the gutter, the label column and the gap after it.
        const valueWidth = panelWidth - 2 - 2 - 2 - COMPACT_LABEL_W - 1;
        const lines = editRowLines(
            { ...edit, suffix: target === "filename" ? `.${outputExt}` : undefined },
            valueWidth
        );
        return lines > 1 ? lines : undefined;
    };

    // What the OLD version shows. A file saved before tags were recorded has no known old values, so its
    // fields are shown as unchanged rather than claiming that everything differs.
    // Without the track's own edits: what a file saved before edits existed most likely holds.
    const oldValues =
        (diskTags?.path === oldPath ? diskTags?.values : undefined) ??
        oldSource?.savedFile?.tags ??
        (baseCompiled ? compiledFieldValues(baseCompiled) : {});
    const oldProvenance = getSavedFileDisplay(oldSource?.fileInfo, oldSource?.savedFile?.converted);
    const oldFormatLabel = oldProvenance.badge || (oldSource?.fileInfo?.format ?? "flac").toUpperCase();
    const oldBytes = oldSource?.savedFile?.converted?.sizeBytes ?? oldSource?.fileInfo?.sizeBytes;
    const oldSize = oldBytes !== undefined ? formatBytes(oldBytes) : "—";
    const oldDuration = formatDuration(oldSource?.fileInfo?.durationMs ?? oldSource?.track.duration ?? 0);
    const oldFilename = oldPath ? path.basename(oldPath) : "";
    const oldDir = oldPath ? path.dirname(oldPath) : "";
    // Where the NEW file goes is not where the OLD one is: the output block is then the new destination.
    const targetChanged = compare && (currentFilename !== oldFilename || !isSameDir(outputDir, oldDir));

    /** An attribute row that exists on both sides: the NEW cell goes green and the OLD one red where they differ. */
    const attributeRow = (
        key: string,
        label: string,
        newValue: string,
        oldValue: string,
        newColor?: string
    ): DetailRowSpec => {
        const changed = compare && newValue !== oldValue;
        return {
            key,
            changed,
            node: (
                <DetailRow
                    variant="attribute"
                    label={label}
                    value={newValue}
                    valueColor={changed ? theme.status.success : newColor}
                    labelWidth={labelWidth}
                    inset={inset}
                />
            ),
            old: <DiffCell variant="attribute" label={label} value={oldValue} tone={changed ? "removed" : "same"} />,
        };
    };

    // ── Rows ──────────────────────────────────────────────────────────────────
    // Every row is one terminal row tall (the player is two), so the pane can show a window of them.

    const rows: DetailRowSpec[] = [];

    if (canPlay || compare) {
        rows.push({
            key: "player",
            height: 2,
            node: canPlay ? (
                <PlaybackBar
                    positionMs={newPlayback.positionMs}
                    durationMs={displayDurationMs}
                    width={innerW}
                    isPlaying={newPlayback.isPlaying}
                    isPaused={newPlayback.isPaused}
                    isFocused={isActive && current === "player"}
                    onToggle={() => {
                        focusPane();
                        setCursor("player");
                        togglePlayback();
                    }}
                    onSeek={(fraction) => {
                        focusPane();
                        setCursor("player");
                        seekToFraction(fraction);
                    }}
                />
            ) : (
                blankRow(2)
            ),
            // The OLD file can only be played, to compare it by ear with the new one.
            old:
                oldSource && oldPath ? (
                    <PlaybackBar
                        positionMs={oldPlayback.positionMs}
                        durationMs={
                            oldPlayback.durationMs > 0 ? oldPlayback.durationMs : (oldSource.fileInfo?.durationMs ?? 0)
                        }
                        width={oldWidth - 2}
                        isPlaying={oldPlayback.isPlaying}
                        isPaused={oldPlayback.isPaused}
                        isFocused={isActive && current === "oldPlayer"}
                        onToggle={() => {
                            focusPane();
                            setCursor("oldPlayer");
                            toggleFilePlayback(oldPath);
                        }}
                        onSeek={(fraction) => {
                            focusPane();
                            setCursor("oldPlayer");
                            seekFileToFraction(oldPath, fraction, oldSource.fileInfo?.durationMs ?? 0);
                        }}
                    />
                ) : undefined,
        });
    }

    rows.push({
        key: "source",
        changed:
            compare &&
            !!oldSource &&
            (oldSource.provider !== source.provider ||
                oldSource.track.uri !== source.track.uri ||
                oldSource.providerDetail !== source.providerDetail),
        node: compare ? (
            <SourceCell source={source} />
        ) : (
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
        old: oldSource ? <SourceCell source={oldSource} /> : undefined,
    });
    rows.push({ key: "gap-source", node: blankRow() });

    if (fileNotFound) {
        rows.push(
            {
                key: "missing",
                node: (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.status.warning}>
                            {source.savedFile ? "△ Saved file not found on disk" : "△ File not found"}
                        </Text>
                    </Box>
                ),
            },
            {
                key: "missing-path",
                node: (
                    <Box paddingX={1} flexShrink={0}>
                        <Text color={theme.text.secondary} dimColor wrap="truncate-end">
                            Last known: {source.savedFile?.path ?? source.localFile?.path ?? "—"}
                        </Text>
                    </Box>
                ),
            },
            { key: "gap-missing", node: blankRow() },
            {
                key: "missing-hint",
                node: (
                    <Box paddingX={1} flexShrink={0} flexDirection="row" columnGap={1}>
                        <ActionButton
                            label="Relocate"
                            onClick={() => {
                                focusPane();
                                onRelocateFile();
                            }}
                        />
                        <Hint shortcutId="downloadSourceDetail.relocate" label="" />
                    </Box>
                ),
            }
        );
    } else {
        const clickable = (target: string, node: React.ReactNode) => (
            <ClickableBox onClick={() => clickRow(target)}>{node}</ClickableBox>
        );
        const editedBadge = { text: "EDITED", color: theme.field.overridden, italic: true, strong: true };

        // The file itself: its name (editable), where it goes, format, quality, size and length.
        rows.push({
            key: "attr-header",
            node: <AttributesHeader label="File attributes" inset={inset} />,
            old: <AttributesHeader label="File attributes" inset={false} />,
        });
        if (compiled) {
            const fileChanged = compare && currentFilename !== oldFilename;
            rows.push({
                key: "filename",
                height: editHeight("filename"),
                changed: fileChanged,
                node: clickable(
                    "filename",
                    <FocusRow
                        variant="attribute"
                        label="File"
                        value={currentFilename}
                        valueColor={
                            filenameOverride ? theme.field.overridden : fileChanged ? theme.status.success : undefined
                        }
                        isFocused={isActive && current === "filename"}
                        edit={editFor("filename")}
                        badge={filenameOverride ? editedBadge : undefined}
                        labelWidth={labelWidth}
                        inset={inset}
                    />
                ),
                old: (
                    <DiffCell
                        variant="attribute"
                        label="File"
                        value={oldFilename}
                        tone={fileChanged ? "removed" : "same"}
                    />
                ),
            });
        }
        if (compare) rows.push(attributeRow("folder", "Folder", outputDir, oldDir));
        rows.push(
            attributeRow(
                "format",
                "Format",
                formatLabel,
                oldFormatLabel,
                provenance.badge ? provenanceColor : undefined
            )
        );
        if (provenance.detail) {
            rows.push(
                attributeRow("quality", "Quality", provenance.detail, oldProvenance.detail ?? "—", theme.status.warning)
            );
        }
        rows.push(
            attributeRow("size", "Size", sizeText, oldSize),
            attributeRow("duration", "Duration", formatDuration(sourceDurationMs), oldDuration),
            { key: "gap-attr", node: blankRow() }
        );

        // What saving writes into the file's tags.
        if (compiled) {
            rows.push(
                {
                    key: "overwrite",
                    height: tagsLines > 1 ? tagsLines : undefined,
                    node: clickable(
                        "overwrite",
                        <FocusRow
                            label="Tags"
                            value={tagsText}
                            lines={tagsLines}
                            valueColor={overwriteTags ? theme.status.success : theme.text.secondary}
                            isFocused={isActive && current === "overwrite"}
                            labelWidth={labelWidth}
                        />
                    ),
                },
                { key: "gap-overwrite", node: blankRow() }
            );
            for (const field of META_FIELDS) {
                const target = fieldTarget(field);
                const value = field.getCompiledValue(compiled);
                const oldValue = oldValues[field.key] ?? "—";
                // Tags that are not being written do not change.
                const changed = compare && overwriteTags && value !== oldValue;
                const edited = isOverridden(target);
                const attribution = attributionBadge(compiled.attribution[field.key], theme);
                const row = (
                    <FocusRow
                        label={field.label}
                        value={value}
                        valueColor={
                            value === "—"
                                ? theme.field.missing
                                : edited
                                  ? theme.field.overridden
                                  : changed
                                    ? theme.status.success
                                    : theme.field.normal
                        }
                        dim={!overwriteTags}
                        isFocused={isActive && current === target}
                        edit={editFor(target)}
                        badge={edited ? editedBadge : attribution.text && !compare ? attribution : undefined}
                        labelWidth={labelWidth}
                    />
                );
                rows.push({
                    key: target,
                    height: editHeight(target),
                    changed,
                    node: field.editable ? clickable(target, row) : row,
                    old: <DiffCell label={field.label} value={oldValue} tone={changed ? "removed" : "same"} />,
                });
            }
            rows.push({ key: "gap-fields", node: blankRow() });

            // What saving writes of MusicBrainz: a switch, and the ids it would put in the file.
            if (showMusicBrainz && musicBrainzIds) {
                // Written only when both switches are on. Side by side the NEW column says what the file will hold
                // (nothing, when they are off: the old ids are then dropped); alone, the ids are shown dimmed.
                const writes = includeMusicBrainzTags && overwriteTags;
                const oldMusicBrainzTags = compare && diskTags?.path === oldPath ? diskTags.tags : undefined;
                rows.push({
                    key: "mbtags",
                    // The ids under the bar are part of the block: the cursor on the bar keeps all of them in view.
                    focusSpan: MUSICBRAINZ_TAG_FIELDS.length + 1,
                    node: clickable(
                        "mbtags",
                        <AttributesHeader
                            label={`${includeMusicBrainzTags ? "☒" : "☐"} Include MusicBrainz tags`}
                            tint={musicBrainzColors}
                            inset={inset}
                            focusable
                            isFocused={isActive && current === "mbtags"}
                            badge={
                                musicBrainzFileState
                                    ? {
                                          text: musicBrainzFileState.toUpperCase(),
                                          color:
                                              musicBrainzFileState === "in file"
                                                  ? theme.status.success
                                                  : musicBrainzFileState === "differs"
                                                    ? theme.status.warning
                                                    : musicBrainzColors.headerText,
                                      }
                                    : undefined
                            }
                        />
                    ),
                    old: <AttributesHeader label="MusicBrainz tags" tint={musicBrainzColors} inset={false} />,
                });
                for (const { label, shortLabel, tag, idOf } of MUSICBRAINZ_TAG_FIELDS) {
                    const id = idOf(musicBrainzIds) ?? "—";
                    const newValue = compare && !writes ? "—" : id;
                    // Not read yet: no claim that anything differs.
                    const oldValue = oldMusicBrainzTags ? tagValue(oldMusicBrainzTags, tag) : newValue;
                    const changed = compare && newValue !== oldValue;
                    rows.push({
                        key: `mbid:${tag}`,
                        changed,
                        node: (
                            <FocusRow
                                variant="attribute"
                                tint={musicBrainzColors}
                                label={compare ? shortLabel : label}
                                value={newValue}
                                valueColor={changed ? theme.status.success : undefined}
                                dim={!compare && !writes}
                                labelWidth={compare ? COMPACT_LABEL_W : MUSICBRAINZ_LABEL_W}
                                inset={inset}
                                truncate="truncate-middle"
                            />
                        ),
                        old: (
                            <DiffCell
                                variant="attribute"
                                tint={musicBrainzColors}
                                label={shortLabel}
                                value={oldValue}
                                tone={changed ? "removed" : "same"}
                            />
                        ),
                    });
                }
                rows.push({ key: "gap-mbtags", node: blankRow() });
            }
        }

        // The tags the file came with matter for the new file only; the old one is judged by what was saved.
        if (!compare) {
            rows.push({ key: "divider-tags", node: <SectionDivider label="Embedded Tags" width={innerW} /> });
            for (const tag of [...PRIORITY_TAGS, ...otherTagKeys]) {
                rows.push({ key: `tag:${tag}`, node: <DetailRow label={tag} value={tagValue(embeddedTags, tag)} /> });
            }
            if (showEmbeddedMusicBrainz) {
                rows.push(
                    { key: "gap-embedded-mb", node: blankRow() },
                    { key: "divider-embedded-mb", node: <SectionDivider label="MusicBrainz in file" width={innerW} /> }
                );
                for (const { label, tag } of MUSICBRAINZ_TAG_FIELDS) {
                    rows.push({
                        key: `mbtag:${tag}`,
                        node: (
                            <DetailRow
                                label={label}
                                value={tagValue(embeddedTags, tag)}
                                labelColor={musicBrainzColor}
                            />
                        ),
                    });
                }
            }
        }
    }

    if (source.savedFile && !compare) {
        rows.push(
            { key: "gap-saved", node: blankRow() },
            { key: "divider-saved", node: <SectionDivider label="Saved" width={innerW} /> },
            { key: "saved-path", node: <DetailRow label="Path" value={source.savedFile.path} /> },
            { key: "saved-at", node: <DetailRow label="Saved at" value={formatDate(source.savedFile.savedAt)} /> }
        );
    }

    // The output folder is not one of the rows: while the cursor is on it, the rows stay where the last one left them.
    const focusRowKey = current === "output" ? rowFocus : current === "oldPlayer" ? "player" : current;
    const visibleRows =
        viewport.hasMeasured && viewport.height > 0 ? windowRows(rows, focusRowKey, viewport.height) : rows;

    const newPanel = (
        <PanelFrame
            title={panelTitle}
            color={panelColor}
            width={panelWidth}
            grow={!sideBySide}
            viewportRef={viewportRef}
        >
            {visibleRows.map((row) => (
                <React.Fragment key={row.key}>{row.node}</React.Fragment>
            ))}
        </PanelFrame>
    );

    return (
        <Box ref={rootRef} flexDirection="column" width={width} height={height} overflow="hidden">
            {sideBySide ? (
                <Box flexDirection="row" flexGrow={1} overflow="hidden">
                    <PanelFrame title="OLD VERSION" color={theme.status.error} width={oldWidth}>
                        {visibleRows.map((row) => (
                            <Box
                                key={row.key}
                                flexDirection="column"
                                height={row.height ?? 1}
                                flexShrink={0}
                                overflow="hidden"
                            >
                                {row.old ?? blankRow(row.height)}
                            </Box>
                        ))}
                    </PanelFrame>
                    <Box width={ARROW_W} flexShrink={0} flexDirection="column" overflow="hidden">
                        {/* The panels' title row, then one cell per row: an arrow where the versions differ. */}
                        {blankRow()}
                        {visibleRows.map((row) => (
                            <Box key={row.key} height={row.height ?? 1} flexShrink={0}>
                                {row.changed && (
                                    <Text color={theme.diff.modified} bold>
                                        {" → "}
                                    </Text>
                                )}
                            </Box>
                        ))}
                    </Box>
                    {newPanel}
                </Box>
            ) : (
                newPanel
            )}

            {compiled && (
                <OutputFolderBlock
                    width={width}
                    label={targetChanged ? "NEW OUTPUT FOLDER" : "OUTPUT FOLDER"}
                    dir={outputDir}
                    filename={currentFilename}
                    isOverridden={isOutputOverridden}
                    folderExists={folderExists}
                    isFocused={isActive && current === "output"}
                    notice={notice}
                    replacesExisting={replacesExisting}
                    edit={
                        outputEdit
                            ? {
                                  draft: outputEdit.draft,
                                  error: outputEdit.error,
                                  inputKey: outputEdit.inputKey,
                                  onChange: handleDraftChange,
                                  onSubmit: handleDraftSubmit,
                              }
                            : null
                    }
                    onClick={() => clickRow("output")}
                />
            )}
        </Box>
    );
};
