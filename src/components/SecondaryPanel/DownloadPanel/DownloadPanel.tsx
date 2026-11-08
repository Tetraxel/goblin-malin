import React, { useState, useEffect } from "react";
import { Box } from "ink";
import fs from "fs";
import path from "path";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { Task, TaskSnapshot } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { useTheme } from "#base/themeContext";
import { DownloadProvider, MusicDownloadTaskAttributes, TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeCompiledMetadata, CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { getSaveSettings } from "#flows/musicDownloadFlow/saveSettings";
import { computeOutputPath, samePath } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import { isSameDir } from "#flows/musicDownloadFlow/utils/cleanOutputDir";
import { DownloadSourceTree } from "./DownloadSourceTree/DownloadSourceTree";
import { DownloadSourceDetail } from "./DownloadSourceDetail/DownloadSourceDetail";
import { ProviderSummary } from "./DownloadSourceDetail/ProviderSummary";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { useShortcuts } from "#hooks/useShortcuts";
import type { Updater } from "#hooks/useFocusManager";

const HINT_BAR_HEIGHT = 2;

interface DownloadPanelProps {
    selectedTask: Task | null;
    width: number;
    height: number;
}

export const DownloadPanel: React.FC<DownloadPanelProps> = ({ selectedTask, width, height }) => {
    const theme = useTheme();
    const { setSourcesInnerFocus, focusSourcesPane, setIsEditingField } = useFocusActions();
    const { activeWindow, isEditingField } = useFocusChrome();
    const secondaryPanel = useFocusSecondaryPanel();

    const { sourcesPanel } = secondaryPanel;
    const { innerFocus } = sourcesPanel;
    const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
    // The provider whose header holds the cursor; null while it is on one of the rows.
    const [focusedProvider, setFocusedProvider] = useState<DownloadProvider | null>(null);
    // The cursor is on the pinned "saved file" row (the detail then shows the saved source, like its own row does).
    const [savedFocused, setSavedFocused] = useState(false);

    const isPanelActive = activeWindow === "secondaryPanel" && secondaryPanel.subTab === "downloadSources";

    const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

    const [snapshot, setSnapshot] = useState<TaskSnapshot<MusicDownloadTaskAttributes> | undefined>(
        () => typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined
    );
    // Shows what each provider was actually asked for under its rows (the "e" toggle, like the Metadata tab's).
    const [showQuery, setShowQuery] = useState(false);

    const [prevTypedTask, setPrevTypedTask] = useState(typedTask);
    if (prevTypedTask !== typedTask) {
        setPrevTypedTask(typedTask);
        const nextSnapshot = typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined;
        setSnapshot(nextSnapshot);
        // The selected task can change under a focused panel (mouse-wheel scrolling the
        // list), so don't carry the previous task's source cursor over: land on the new task's chosen source.
        const nextSources = nextSnapshot?.attributes?.kind === "track" ? nextSnapshot.attributes.downloadSources : [];
        setSelectedSourceIndex(
            Math.max(
                0,
                nextSources.findIndex((s) => s.selected)
            )
        );
        setFocusedProvider(null);
        setSavedFocused(false);
    }

    useEffect(() => {
        if (!typedTask) return;
        return (typedTask as Task<MusicDownloadTaskAttributes>).subscribe((t) => {
            setSnapshot(t.get() as TaskSnapshot<MusicDownloadTaskAttributes>);
        });
    }, [typedTask]);

    // A collection (album/playlist) task has no download sources of its own —
    // select a child track to see its downloads.
    const downloadSources: TrackDownloadSource[] =
        snapshot?.attributes?.kind === "track" ? snapshot.attributes.downloadSources : [];

    const savedSource: TrackDownloadSource | null = downloadSources.find((s) => s.savedFile != null) ?? null;

    const compiled: CompiledMetadata | null =
        snapshot?.attributes?.kind === "track"
            ? computeCompiledMetadata(snapshot.attributes.metadataGroups, snapshot.attributes.metadataOverride)
            : null;

    const baseCompiled: CompiledMetadata | null =
        snapshot?.attributes?.kind === "track" ? computeCompiledMetadata(snapshot.attributes.metadataGroups, {}) : null;

    const { outputDir: defaultOutputDir } = getSaveSettings();
    const outputDirOverride =
        snapshot?.attributes?.kind === "track" ? snapshot.attributes.outputDirOverride : undefined;
    const outputDir = outputDirOverride ?? defaultOutputDir;
    const trackAttrs = snapshot?.attributes?.kind === "track" ? snapshot.attributes : null;
    const filenameOverride = trackAttrs?.outputFilenameOverride;
    const overwriteTags = trackAttrs?.overwriteTags !== false;

    const downloadNavIndex =
        downloadSources.length === 0
            ? -1
            : Math.max(0, Math.min(selectedSourceIndex < 0 ? 0 : selectedSourceIndex, downloadSources.length - 1));

    const [splitRatio, setSplitRatio] = useState(0.6);
    const leftWidth = Math.floor(width * splitRatio) - 4;
    const rightWidth = width - leftWidth - 4;
    const listHeight = height - HINT_BAR_HEIGHT;

    const savedIndex = downloadSources.findIndex((s) => s.savedFile != null);
    // The pinned saved row is only there while a file is saved.
    const onSaved = savedFocused && savedSource != null && focusedProvider === null;
    const cursorSource = focusedProvider ? null : (downloadSources[downloadNavIndex] ?? null);

    // The diff follows the cursor. On any other source that has a file, the saved file (OLD) is shown next to
    // that source (NEW): what Enter would replace it with.
    const isSourceSwitch =
        savedSource != null &&
        cursorSource != null &&
        cursorSource !== savedSource &&
        cursorSource.localFile?.state === "found";

    // On the saved file itself: does saving now rename or move it? The name it would get is worked out like
    // saving does.
    // Only an explicit per-track folder counts: changing the default folder in Settings applies to new saves,
    // it doesn't drag every saved file along.
    const savedPath = savedSource?.savedFile?.path ?? null;
    const hasFolderChange =
        outputDirOverride != null && savedPath != null && !isSameDir(path.dirname(savedPath), outputDirOverride);
    const hasMetadataChange =
        compiled != null &&
        savedPath != null &&
        !samePath(
            computeOutputPath(compiled, outputDirOverride ?? path.dirname(savedPath), filenameOverride),
            savedPath
        );
    const isMetadataChange =
        !isSourceSwitch && cursorSource != null && cursorSource === savedSource && hasMetadataChange;

    const showDiff = isSourceSwitch || isMetadataChange;
    const effectivePendingSource = isSourceSwitch ? cursorSource : isMetadataChange ? savedSource : null;

    useShortcuts({
        id: "downloadPanel",
        isActive: isPanelActive && innerFocus === "list" && !isEditingField,
        priority: 100,
        shortcuts: [
            {
                id: "downloadPanel.shrink",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Shrink",
                handler: () => setSplitRatio((prev) => Math.max(0.2, prev - 0.04)),
            },
            {
                id: "downloadPanel.expand",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Expand",
                handler: () => setSplitRatio((prev) => Math.min(0.75, prev + 0.04)),
            },
            {
                id: "downloadPanel.toggleQuery",
                defaultShortcut: { input: "e" },
                label: "Toggle query",
                handler: () => setShowQuery((prev) => !prev),
            },
        ],
        hintLines: [
            {
                id: "downloadPanel.line.panel",
                left: { type: "text", value: "Download Panel", bold: true },
                shortcutIds: ["downloadPanel.shrink", "downloadPanel.expand", "downloadPanel.toggleQuery"],
            },
        ],
    });

    // Pointer handlers.
    function handleClickSource(idx: number) {
        focusSourcesPane("list");
        selectSource(idx);
    }

    function handleScrollSource(next: Updater<number>) {
        setFocusedProvider(null);
        setSavedFocused(false);
        setSelectedSourceIndex(next);
    }

    /** Moves the cursor onto one of the rows. */
    function selectSource(idx: number) {
        setFocusedProvider(null);
        setSavedFocused(false);
        setSelectedSourceIndex(idx);
    }

    /** Moves the cursor onto a provider's header (a click on it also focuses the list). */
    function handleFocusProvider(provider: DownloadProvider) {
        focusSourcesPane("list");
        setSavedFocused(false);
        setFocusedProvider(provider);
    }

    /** Moves the cursor onto the pinned saved file (a click on it also focuses the list). */
    function handleFocusSaved() {
        if (savedIndex < 0) return;
        focusSourcesPane("list");
        setFocusedProvider(null);
        setSavedFocused(true);
        setSelectedSourceIndex(savedIndex);
    }

    /** Lists the next results of one search (a click on its "show more" row, or the shortcut). */
    function handleShowMore(anchorIndex: number) {
        const added = (typedTask as unknown as DownloadTask)?.showMoreSources(anchorIndex) ?? 0;
        // The new rows go in under the anchor: keep the cursor on the row it was on.
        if (added > 0 && !focusedProvider && selectedSourceIndex > anchorIndex) {
            setSelectedSourceIndex(selectedSourceIndex + added);
        }
    }

    function canRetryProvider(provider: DownloadProvider): boolean {
        return typedTask instanceof DownloadTask && typedTask.canRetryDownloadProvider(provider);
    }

    function handleRetryProvider(provider: DownloadProvider) {
        (typedTask as unknown as DownloadTask)?.retryDownloadProvider(provider).catch(() => {
            // already logged by the task
        });
    }

    function handleRequestSelect(idx: number) {
        const isAlreadySelected = downloadSources[idx]?.selected;
        if (isSourceSwitch && idx === downloadNavIndex) {
            // Replacing the saved file is confirmed in the side-by-side view.
            setSourcesInnerFocus("detail");
        } else if (!isAlreadySelected) {
            (typedTask as unknown as DownloadTask)?.selectDownloadSource(idx);
        }
    }

    function handleRejectSource(idx: number) {
        const source = downloadSources[idx];
        if (!source) return;
        (typedTask as unknown as DownloadTask)?.rejectDownloadSource(idx, !source.isRejected);
    }

    function handleRetrySource(idx: number) {
        (typedTask as unknown as DownloadTask)?.retryDownloadSource(idx);
    }

    /** Saves the file of the focused source: the selected one directly, another one after selecting it. */
    function handleRequestSave(idx: number) {
        const source = downloadSources[idx];
        // A saved source can be saved again (re-tag, rename, move) without its temporary copy.
        if (isSaving || !source || (source.localFile?.state !== "found" && !source.savedFile)) return;
        if (isSourceSwitch) {
            // The comparison with the saved file is already on screen: this source takes its place.
            (typedTask as unknown as DownloadTask)?.selectDownloadSource(idx);
            handleSave();
        } else if (source.selected) {
            handleSave();
        } else {
            (typedTask as unknown as DownloadTask)?.selectDownloadSource(idx);
            handleSave();
        }
    }

    function handleConfirmDiff() {
        if (isSourceSwitch) {
            // The source under the cursor takes the saved file's place.
            (typedTask as unknown as DownloadTask)?.selectDownloadSource(downloadNavIndex);
            setSourcesInnerFocus("list");
            handleSave();
        } else if (isMetadataChange) {
            // Metadata-only diff: save directly (re-tag + rename the existing file)
            handleSave();
        }
    }

    function handleCancelDiff() {
        // A pending folder move has no other way out of the diff: cancelling drops the custom folder.
        if (isMetadataChange && hasFolderChange) (typedTask as unknown as DownloadTask)?.setOutputDir(undefined);
        setSourcesInnerFocus("list");
    }

    const isSaving = snapshot?.status?.type === StatusType.Processing;

    async function handleSave() {
        if (!typedTask) return;
        try {
            await (typedTask as unknown as DownloadTask).saveTrack();
        } catch {
            // status already set to Error inside saveTrack()
        }
    }

    async function handleRelocateFile() {
        if (!typedTask) return;
        const attrs = typedTask.getAttributes();
        if (attrs?.kind !== "track") return;
        const sourceIdx = downloadNavIndex >= 0 ? downloadNavIndex : 0;
        const source = attrs.downloadSources[sourceIdx];
        if (!source) return;

        const filename = source.localFile?.name ?? "file";
        try {
            const newPath = await typedTask.getPrompt().askInput({
                status: "Relocating file",
                title: "Relocate File",
                message: `Enter new file path for: ${filename}`,
                hint: "Absolute path to the FLAC file",
            });
            if (!newPath.trim()) return;
            if (!fs.existsSync(newPath)) return;
            (typedTask as unknown as DownloadTask)?.updateLocalFile(sourceIdx, newPath);
        } catch {
            // user cancelled
        }
    }

    const selectedSource = downloadNavIndex >= 0 ? (downloadSources[downloadNavIndex] ?? null) : null;

    return (
        <Box
            flexDirection="column"
            height={height}
            overflow="hidden"
            borderStyle="single"
            borderColor={theme.ui.border}
            borderBackgroundColor={theme.ui.background}
            borderTop={false}
            borderBottom={false}
            paddingRight={1}
        >
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
                <DownloadSourceTree
                    sources={downloadSources}
                    showQuery={showQuery}
                    selectedSourceIndex={downloadNavIndex}
                    focusedProvider={focusedProvider}
                    savedFocused={onSaved}
                    isActive={isPanelActive && innerFocus === "list"}
                    width={leftWidth}
                    height={listHeight}
                    onSelectSource={selectSource}
                    onFocusProvider={handleFocusProvider}
                    onFocusSaved={handleFocusSaved}
                    canShowMore={typedTask instanceof DownloadTask && typedTask.canShowMoreSources()}
                    onShowMore={handleShowMore}
                    canRetryProvider={canRetryProvider}
                    onRetryProvider={handleRetryProvider}
                    onClickSource={handleClickSource}
                    onScrollSource={handleScrollSource}
                    onRequestSelect={handleRequestSelect}
                    onRejectSource={handleRejectSource}
                    onRetrySource={handleRetrySource}
                    onRequestSave={handleRequestSave}
                    onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
                />
                <DownloadSourceDetail
                    source={focusedProvider ? null : selectedSource}
                    emptyState={
                        focusedProvider ? (
                            <ProviderSummary
                                provider={focusedProvider}
                                sources={downloadSources.filter((s) => s.provider === focusedProvider)}
                                canRetry={canRetryProvider(focusedProvider)}
                                width={rightWidth}
                                height={listHeight}
                            />
                        ) : undefined
                    }
                    savedSource={savedSource}
                    compiled={compiled}
                    baseCompiled={baseCompiled}
                    overrides={trackAttrs?.metadataOverride ?? {}}
                    outputDir={outputDir}
                    defaultOutputDir={defaultOutputDir}
                    isOutputOverridden={outputDirOverride != null}
                    filenameOverride={filenameOverride}
                    overwriteTags={overwriteTags}
                    isDiffMode={showDiff}
                    diffKind={isSourceSwitch ? "source-switch" : "metadata-change"}
                    pendingSource={effectivePendingSource}
                    isActive={isPanelActive && innerFocus === "detail"}
                    isSaving={isSaving}
                    width={rightWidth}
                    height={listHeight}
                    onInnerFocusSwitch={() => setSourcesInnerFocus("list")}
                    onConfirmDiff={handleConfirmDiff}
                    onCancelDiff={handleCancelDiff}
                    onRelocateFile={handleRelocateFile}
                    onSave={handleSave}
                    onChangeOutputDir={(dir) => (typedTask as unknown as DownloadTask)?.setOutputDir(dir)}
                    onChangeFilename={(name) => (typedTask as unknown as DownloadTask)?.setOutputFilename(name)}
                    onChangeOverwriteTags={(overwrite) =>
                        (typedTask as unknown as DownloadTask)?.setOverwriteTags(overwrite)
                    }
                    onOverridesChange={(updated) => typedTask?.updateAttributes({ metadataOverride: updated })}
                    setIsEditingField={setIsEditingField}
                    onFocusPane={() => focusSourcesPane("detail")}
                />
            </Box>
            <DynamicHintBar width={width - 2} isActive={isPanelActive} />
        </Box>
    );
};
