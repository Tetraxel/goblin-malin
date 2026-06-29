import React, { useState, useEffect } from "react";
import { Box } from "ink";
import fs from "fs";
import path from "path";
import { useFocusActions, useFocusChrome } from "#contexts/FocusContext";
import { Task, TaskSnapshot } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { useTheme } from "#base/themeContext";
import { MusicDownloadTaskAttributes, TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeCompiledMetadata, CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { getSaveSettings } from "#flows/musicDownloadFlow/saveSettings";
import { computeOutputFilename } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import { DownloadSourceTree } from "./DownloadSourceTree/DownloadSourceTree";
import { DownloadSourceDetail } from "./DownloadSourceDetail/DownloadSourceDetail";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { useShortcuts } from "#hooks/useShortcuts";

const HINT_BAR_HEIGHT = 2;

interface DownloadPanelProps {
    selectedTask: Task | null;
    width: number;
    height: number;
}

export const DownloadPanel: React.FC<DownloadPanelProps> = ({ selectedTask, width, height }) => {
    const theme = useTheme();
    const { setSourcesInnerFocus } = useFocusActions();
    const { activeWindow, secondaryPanel, isEditingField } = useFocusChrome();

    const { sourcesPanel } = secondaryPanel;
    const { innerFocus } = sourcesPanel;
    const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);

    const isPanelActive = activeWindow === "secondaryPanel" && secondaryPanel.subTab === "downloadSources";

    const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;

    const [snapshot, setSnapshot] = useState<TaskSnapshot<MusicDownloadTaskAttributes> | undefined>(
        () => typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined
    );
    const [prevTypedTask, setPrevTypedTask] = useState(typedTask);
    if (prevTypedTask !== typedTask) {
        setPrevTypedTask(typedTask);
        setSnapshot(typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined);
    }

    useEffect(() => {
        if (!typedTask) return;
        return (typedTask as Task<MusicDownloadTaskAttributes>).subscribe((t) => {
            setSnapshot(t.get() as TaskSnapshot<MusicDownloadTaskAttributes>);
        });
    }, [typedTask]);

    const downloadSources: TrackDownloadSource[] = snapshot?.attributes?.downloadSources ?? [];

    const savedSource: TrackDownloadSource | null = downloadSources.find((s) => s.savedFile != null) ?? null;

    const compiled: CompiledMetadata | null = snapshot?.attributes
        ? computeCompiledMetadata(snapshot.attributes.metadataGroups, snapshot.attributes.metadataOverride)
        : null;

    const { outputDir } = getSaveSettings();

    const downloadNavIndex =
        downloadSources.length === 0
            ? -1
            : Math.max(0, Math.min(selectedSourceIndex < 0 ? 0 : selectedSourceIndex, downloadSources.length - 1));

    const [splitRatio, setSplitRatio] = useState(0.6);
    const leftWidth = Math.floor(width * splitRatio) - 4;
    const rightWidth = width - leftWidth - 4;
    const listHeight = height - HINT_BAR_HEIGHT;

    const [isDiffMode, setIsDiffMode] = useState(false);
    const [pendingSourceIndex, setPendingSourceIndex] = useState<number | null>(null);

    // Auto-detect when compiled metadata would produce a different filename than what's on disk
    const previewFilename = compiled ? computeOutputFilename(compiled) : null;
    const savedFilename = savedSource?.savedFile ? path.basename(savedSource.savedFile.path) : null;
    const hasMetadataChange = previewFilename != null && savedFilename != null && previewFilename !== savedFilename;

    // Combined diff flag: manually triggered source-switch OR auto-detected metadata change
    const showDiff = isDiffMode || hasMetadataChange;

    // For metadata-only change the "pending" source is the currently selected (saved) source
    const effectivePendingSource = isDiffMode
        ? pendingSourceIndex !== null
            ? (downloadSources[pendingSourceIndex] ?? null)
            : null
        : hasMetadataChange
          ? (downloadSources.find((s) => s.selected) ?? savedSource)
          : null;

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
        ],
        hintLines: [
            {
                id: "downloadPanel.line.panel",
                left: { type: "text", value: "Download Panel", bold: true },
                shortcutIds: ["downloadPanel.shrink", "downloadPanel.expand"],
            },
        ],
    });

    function handleRequestSelect(idx: number) {
        const hasSaved = downloadSources.some((s) => s.savedFile != null);
        const isAlreadySelected = downloadSources[idx]?.selected;
        if (hasSaved && !isAlreadySelected) {
            setPendingSourceIndex(idx);
            setIsDiffMode(true);
            setSourcesInnerFocus("detail");
        } else {
            (typedTask as unknown as DownloadTask)?.selectDownloadSource(idx);
        }
    }

    function handleRejectSource(idx: number) {
        const source = downloadSources[idx];
        if (!source) return;
        (typedTask as unknown as DownloadTask)?.rejectDownloadSource(idx, !source.isRejected);
    }

    function handleConfirmDiff() {
        if (isDiffMode) {
            // Source-switch diff: confirm the new source selection
            if (pendingSourceIndex !== null) {
                (typedTask as unknown as DownloadTask)?.selectDownloadSource(pendingSourceIndex);
            }
            setIsDiffMode(false);
            setPendingSourceIndex(null);
            setSourcesInnerFocus("list");
        } else if (hasMetadataChange) {
            // Metadata-only diff: save directly (re-tag + rename the existing file)
            handleSave();
        }
    }

    function handleCancelDiff() {
        setIsDiffMode(false);
        setPendingSourceIndex(null);
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
        if (!attrs) return;
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
                    selectedSourceIndex={downloadNavIndex}
                    isActive={isPanelActive && innerFocus === "list"}
                    width={leftWidth}
                    height={listHeight}
                    onSelectSource={setSelectedSourceIndex}
                    onRequestSelect={handleRequestSelect}
                    onRejectSource={handleRejectSource}
                    onInnerFocusSwitch={() => setSourcesInnerFocus("detail")}
                />
                <DownloadSourceDetail
                    source={selectedSource}
                    savedSource={savedSource}
                    compiled={compiled}
                    outputDir={outputDir}
                    isDiffMode={showDiff}
                    diffKind={isDiffMode ? "source-switch" : "metadata-change"}
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
                />
            </Box>
            <DynamicHintBar width={width - 2} isActive={isPanelActive} />
        </Box>
    );
};
