import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import path from "path";
import fs from "fs";
import { Box, Text, type DOMElement } from "ink";
import { useFocusActions, useFocusChrome, useFocusSecondaryPanel } from "#contexts/FocusContext";
import { type Task, type TaskSnapshot } from "#base/task/task";
import { useTheme } from "#base/themeContext";
import { dialogBridge, type ListItem } from "#base/bridges/dialogBridge";
import { useWheelTarget } from "#base/mouse/useMouseTarget";
import { globalLogger } from "#base/logger/logger";
import { useFollowTaskSnapshot } from "#hooks/useFollowTaskSnapshot";
import { useShortcuts } from "#hooks/useShortcuts";
import { useNowPlaying } from "#hooks/useNowPlaying";
import { DynamicHintBar } from "#components/DynamicHintBar/DynamicHintBar";
import { togglePlayback } from "#utils/togglePlayback";
import { isAudible, stemPlayer } from "#flows/musicDownloadFlow/stems/stemMixer";
import { revealInFileExplorer } from "#utils/revealInFileExplorer";
import { formatSize } from "#utils/formatBytes";
import {
    type MusicDownloadTaskAttributes,
    type StemKind,
    type TrackDownloadTask,
} from "#flows/musicDownloadFlow/types";
import { type DownloadTask, TaskLockedError } from "#flows/musicDownloadFlow/utils/downloadTask";
import { stemActivity } from "#flows/musicDownloadFlow/stems/stemActivity";
import { stemKindRegistry, stemSetKinds } from "#flows/musicDownloadFlow/stems/stemKinds";
import {
    isStemRunActive,
    isStemRunStale,
    stemCellState,
    stemInputFingerprint,
    stemLayers,
} from "#flows/musicDownloadFlow/stems/stemFiles";
import { getStemSettings } from "#flows/musicDownloadFlow/stems/stemProviders";
import { buildStemRows, isPickedRow, isSelectable, stemRowKey, type StemRow } from "./stemRows";
import { RunRow, SavedHeaderRow, SavedStemRow, SectionTitle, StemFileRow } from "./StemRowView";
import { useStemEngineInfo } from "./useStemEngineInfo";
import { WaveformLayer } from "./WaveformLayer";
import { ProgressLine } from "./ProgressLine";

const HINT_BAR_HEIGHT = 2;

interface StemsPanelProps {
    selectedTask: Task | null;
    width: number;
    height: number;
}

/** Says why something the user asked for was refused (a dialog: the reason is worth reading). */
function tell(title: string, error: unknown): void {
    if (error instanceof TaskLockedError) {
        globalLogger.warn("Claude is working on this track: try again when it is done");
        return;
    }
    globalLogger.warn(`${title}: ${error instanceof Error ? error.message : String(error)}`);
    void dialogBridge.confirm({
        title,
        message: error instanceof Error ? error.message : String(error),
        choices: [{ label: "OK", tone: "primary" }],
    });
}

/**
 * The Stems tab (P33): what to separate, with which model, the separation runs of the track and their stems, and
 * the stems saved next to the track. Separation never starts on its own: only from here, the list's actions, or
 * Claude when asked.
 */
export const StemsPanel: React.FC<StemsPanelProps> = ({ selectedTask, width, height }) => {
    const theme = useTheme();
    const { activeWindow, isEditingField } = useFocusChrome();
    const { focusSourcesPane } = useFocusActions();
    const secondaryPanel = useFocusSecondaryPanel();
    const isPanelActive = activeWindow === "secondaryPanel" && secondaryPanel.subTab === "stems";

    const typedTask = selectedTask as Task<MusicDownloadTaskAttributes> | null;
    const downloadTask = typedTask as unknown as DownloadTask | null;
    const [snapshot, setSnapshot] = useState<TaskSnapshot<MusicDownloadTaskAttributes> | undefined>(
        () => typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined
    );
    const [prevTask, setPrevTask] = useState(typedTask);
    const [cursorKey, setCursorKey] = useState<string | undefined>();
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [chosenModel, setChosenModel] = useState<string | undefined>();
    if (prevTask !== typedTask) {
        setPrevTask(typedTask);
        setSnapshot(typedTask?.get() as TaskSnapshot<MusicDownloadTaskAttributes> | undefined);
        setCursorKey(undefined);
        setCollapsed(new Set());
    }
    useFollowTaskSnapshot(typedTask, snapshot, setSnapshot);

    const attrs: TrackDownloadTask | undefined =
        snapshot?.attributes?.kind === "track" ? snapshot.attributes : undefined;
    const engine = useStemEngineInfo();
    const activity = useSyncExternalStore(stemActivity.subscribe, stemActivity.get);
    const nowPlaying = useNowPlaying();
    const stemSet = getStemSettings().stemSet;

    // What a separation would read now, and whether the runs were made from it (asked of the disk, not in render).
    const inputPath =
        attrs?.savedFile?.path ??
        attrs?.downloadSources.find((s) => s.selected && s.localFile?.state === "found")?.localFile?.path;
    const inputKind = attrs?.savedFile ? "saved file" : inputPath ? "selected download" : undefined;
    const [inputFingerprint, setInputFingerprint] = useState<{ path: string; fingerprint?: string } | undefined>();
    useEffect(() => {
        if (!inputPath) return;
        let current = true;
        fs.promises.stat(inputPath).then(
            (stat) => current && setInputFingerprint({ path: inputPath, fingerprint: stemInputFingerprint(stat) }),
            () => current && setInputFingerprint({ path: inputPath })
        );
        return () => {
            current = false;
        };
    }, [inputPath, attrs?.savedFile?.savedAt]);
    const currentFingerprint = inputFingerprint?.path === inputPath ? inputFingerprint?.fingerprint : undefined;

    // The player: the track, then each stem, played together as one mix with a mute and a solo each (`stemMixer.ts`).
    const inputDurationMs =
        attrs?.savedFile?.fileInfo?.durationMs ?? attrs?.downloadSources.find((s) => s.selected)?.fileInfo?.durationMs;
    const layers = useMemo(
        () => (attrs ? stemLayers(attrs, stemSetKinds(stemSet), { path: inputPath, durationMs: inputDurationMs }) : []),
        [attrs, stemSet, inputPath, inputDurationMs]
    );
    const hasStems = layers.some((l) => l.kind && l.path);
    const taskId = typedTask?.getId() ?? "";
    const player = useSyncExternalStore(stemPlayer.subscribe, stemPlayer.getSnapshot);
    const mix = player.mixes.get(taskId) ?? stemPlayer.mixOf(taskId);
    const mixLoaded = player.taskId === taskId && player.status.loaded;
    const mixPlaying = mixLoaded && !player.status.paused;
    // A stem picked or saved while the mix plays: it goes on with the new files, where it was.
    useEffect(() => {
        if (taskId) void stemPlayer.layersChanged(taskId, layers);
    }, [taskId, layers]);

    const rows = useMemo(
        () => (attrs ? buildStemRows(attrs, stemSet, collapsed, hasStems ? layers.map((l) => l.key) : []) : []),
        [attrs, stemSet, collapsed, hasStems, layers]
    );
    const selectable = rows.filter(isSelectable);
    const cursorIndex = Math.max(
        0,
        selectable.findIndex((r) => stemRowKey(r) === cursorKey)
    );
    const cursorRow: StemRow | undefined = selectable[cursorIndex];

    const runOf = (runId: string) => attrs?.stemRuns?.find((r) => r.id === runId);
    const anyRunning = !!attrs?.stemRuns?.some(isStemRunActive);
    const model = chosenModel ?? engine.defaultModel;
    const modelLabel = engine.models.find((m) => m.id === model)?.label ?? model;
    const notFollowing = Object.keys(attrs?.savedStems ?? {}).some(
        (kind) =>
            attrs &&
            stemCellState(attrs, kind).state === "saved" &&
            !(stemCellState(attrs, kind) as { follows: boolean }).follows
    );

    /** The file under the cursor, if it has one (what Space plays and "o" reveals). */
    const cursorFile = (() => {
        if (!cursorRow || !attrs) return undefined;
        if (cursorRow.type === "layer") return layers.find((l) => l.key === cursorRow.key)?.path;
        if (cursorRow.type === "saved") return attrs.savedStems?.[cursorRow.kind]?.path;
        if (cursorRow.type === "stem") {
            const stem = runOf(cursorRow.runId)?.stems.find((s) => s.kind === cursorRow.kind);
            return stem?.state === "found" ? stem.path : undefined;
        }
        return undefined;
    })();

    function moveCursor(delta: number) {
        if (selectable.length === 0) return;
        const next = Math.max(0, Math.min(selectable.length - 1, cursorIndex + delta));
        const row = selectable[next];
        setCursorKey(stemRowKey(row));
    }

    /** Space: on a layer, the play / pause of the whole mix; on a run's or a saved stem, that file alone. */
    function play() {
        if (cursorRow?.type === "layer") {
            if (hasStems) void stemPlayer.togglePlay(taskId, layers);
            return;
        }
        if (cursorFile) togglePlayback(cursorFile);
    }

    function toggleSolo(key: string) {
        void stemPlayer.toggleSolo(taskId, key);
    }

    function toggleMute(key: string) {
        void stemPlayer.toggleMute(taskId, key);
    }

    async function separate() {
        if (!downloadTask) return;
        if (anyRunning) {
            try {
                downloadTask.stopStems();
            } catch (error) {
                tell("Could not stop the separation", error);
            }
            return;
        }
        try {
            const { run } = await downloadTask.startStemSeparation({ model });
            setCursorKey(stemRowKey({ type: "run", runId: run.id }));
        } catch (error) {
            tell("Stems cannot be separated", error);
        }
    }

    async function chooseModel() {
        const models = engine.models;
        if (models.length === 0) {
            tell("No stem model", new Error("No model is downloaded yet: Settings → Stems → Download models…"));
            return;
        }
        const items = models.map((m): ListItem => ({
            label: `${m.id === model ? "● " : ""}${m.label}`,
            detail: [
                `${m.family} · ${m.stems.length ? m.stems.map((k) => stemKindRegistry.get(k).label).join(", ") : "stems known after a run"}${m.sizeBytes ? ` · ${formatSize(m.sizeBytes)}` : ""}`,
            ],
        }));
        const answer = await dialogBridge.choose({
            title: "Separate with which model?",
            intro: "Downloaded models (more in Settings → Stems → Download models…). Each run is kept, so you can compare models by ear.",
            items,
            noneLabel: "Cancel",
            initialIndex: Math.max(
                0,
                models.findIndex((m) => m.id === model)
            ),
        });
        if (answer && "index" in answer) setChosenModel(models[answer.index]?.id);
    }

    function pick() {
        if (!downloadTask || cursorRow?.type !== "stem") return;
        try {
            downloadTask.pickStem(cursorRow.kind, cursorRow.runId);
        } catch (error) {
            tell("Could not use this stem", error);
        }
    }

    async function save(all: boolean) {
        if (!downloadTask || !attrs) return;
        let kinds: StemKind[] | undefined;
        try {
            if (!all && cursorRow?.type === "stem") {
                downloadTask.pickStem(cursorRow.kind, cursorRow.runId);
                kinds = [cursorRow.kind];
            } else if (!all && cursorRow?.type === "run") {
                const run = runOf(cursorRow.runId);
                if (run?.state !== "done") return;
                for (const stem of run.stems) downloadTask.pickStem(stem.kind, run.id);
                kinds = run.stems.map((s) => s.kind);
            } else if (!all && cursorRow?.type === "saved") {
                kinds = [cursorRow.kind];
            }
            const saved = await downloadTask.saveStems(kinds);
            globalLogger.info(`Saved ${saved.length} stem${saved.length === 1 ? "" : "s"}`);
        } catch (error) {
            tell("Stems not saved", error);
        }
    }

    async function remove() {
        if (!downloadTask || !cursorRow || !attrs) return;
        if (cursorRow.type === "run") {
            const run = runOf(cursorRow.runId);
            if (!run) return;
            if (isStemRunActive(run)) {
                tell("Still separating", new Error("Stop the separation first (the same key as Separate)."));
                return;
            }
            const unsaved = run.stems.filter(
                (s) => s.state === "found" && attrs.savedStems?.[s.kind]?.runId !== run.id
            ).length;
            const answer = await dialogBridge.confirm({
                title: "Delete this separation?",
                message: `${run.modelLabel ?? run.model}: its ${run.stems.length} temporary file${run.stems.length === 1 ? "" : "s"} are deleted${unsaved > 0 ? ` (${unsaved} not saved anywhere else)` : ""}.\n\nStems already saved next to the track stay.`,
                choices: [
                    { label: "Keep it", tone: "primary" },
                    { label: "Delete", tone: "danger" },
                ],
            });
            if (answer !== 1) return;
            try {
                await downloadTask.deleteStemRun(run.id);
            } catch (error) {
                tell("Could not delete the separation", error);
            }
        } else if (cursorRow.type === "saved") {
            const stem = attrs.savedStems?.[cursorRow.kind];
            if (!stem) return;
            const exists = await fs.promises.access(stem.path).then(
                () => true,
                () => false
            );
            const answer = await dialogBridge.confirm({
                title: exists ? "Forget this saved stem?" : "Forget the missing stem?",
                message: exists
                    ? `${stem.path}\n\nThe file stays on disk; the track just stops listing it.`
                    : `${stem.path} is not on disk any more. The track stops listing it.`,
                choices: [
                    { label: "Keep it", tone: "primary" },
                    { label: "Forget", tone: "danger" },
                ],
            });
            if (answer !== 1) return;
            try {
                downloadTask.forgetSavedStem(cursorRow.kind);
            } catch (error) {
                tell("Could not forget the stem", error);
            }
        }
    }

    async function rename() {
        if (!downloadTask) return;
        try {
            const moved = await downloadTask.renameStemsToMatch();
            globalLogger.info(`Renamed ${moved} stem${moved === 1 ? "" : "s"} after the track`);
        } catch (error) {
            tell("Stems not renamed", error);
        }
    }

    function toggleRun() {
        if (cursorRow?.type !== "run") return;
        const id = cursorRow.runId;
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    const canSave = !!attrs?.savedFile && rows.some((r) => r.type === "stem");
    const onStem = cursorRow?.type === "stem";
    const onRun = cursorRow?.type === "run";
    const onSaved = cursorRow?.type === "saved";
    const onLayer = cursorRow?.type === "layer";

    useShortcuts({
        id: "stemsPanel",
        isActive: isPanelActive && !isEditingField,
        priority: 100,
        shortcuts: [
            { id: "stemsPanel.up", defaultShortcut: { key: "upArrow" }, label: "Up", handler: () => moveCursor(-1) },
            {
                id: "stemsPanel.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => moveCursor(1),
            },
            {
                id: "stemsPanel.playPause",
                defaultShortcut: { input: " " },
                label: "Play/Pause",
                handler: () => {
                    play();
                },
            },
            {
                // Enter does what the row under the cursor is for: solo a layer, fold a run, use a run's stem.
                id: "stemsPanel.pick",
                defaultShortcut: { key: "return" },
                label: onLayer ? "Solo" : onRun ? "Fold" : "Use this one",
                handler: () => {
                    if (cursorRow?.type === "layer") toggleSolo(cursorRow.key);
                    else if (onRun) toggleRun();
                    else pick();
                },
            },
            {
                id: "stemsPanel.mute",
                defaultShortcut: { input: "x" },
                label: "Mute",
                handler: () => {
                    if (cursorRow?.type === "layer") toggleMute(cursorRow.key);
                },
            },
            {
                id: "stemsPanel.separate",
                defaultShortcut: { input: "r" },
                label: anyRunning ? "Stop" : "Separate",
                handler: () => void separate(),
            },
            {
                id: "stemsPanel.model",
                defaultShortcut: { input: "m" },
                label: "Model",
                handler: () => void chooseModel(),
            },
            { id: "stemsPanel.save", defaultShortcut: { input: "s" }, label: "Save", handler: () => void save(false) },
            {
                id: "stemsPanel.saveAll",
                defaultShortcut: { input: "a" },
                label: "Save all",
                handler: () => void save(true),
            },
            {
                id: "stemsPanel.delete",
                defaultShortcut: { key: "delete" },
                label: onRun ? "Delete run" : "Forget",
                handler: () => void remove(),
            },
            {
                id: "stemsPanel.rename",
                defaultShortcut: { input: "n" },
                label: "Rename to match",
                handler: () => void rename(),
            },
            {
                id: "stemsPanel.seekBack",
                defaultShortcut: { key: "leftArrow", shift: true },
                label: "Seek -5s",
                handler: () => void stemPlayer.seekBy(taskId, -5000),
            },
            {
                id: "stemsPanel.seekForward",
                defaultShortcut: { key: "rightArrow", shift: true },
                label: "Seek +5s",
                handler: () => void stemPlayer.seekBy(taskId, 5000),
            },
            {
                id: "stemsPanel.reveal",
                defaultShortcut: { input: "o" },
                label: "Show in folder",
                handler: () => {
                    if (cursorFile) revealInFileExplorer(cursorFile);
                },
            },
        ],
        hintLines: [
            {
                id: "stemsPanel.line.main",
                left: { type: "text", value: "Stems", bold: true },
                shortcutIds: [
                    "stemsPanel.separate",
                    "stemsPanel.model",
                    ...(canSave ? ["stemsPanel.saveAll"] : []),
                    ...(notFollowing ? ["stemsPanel.rename"] : []),
                ],
            },
            {
                id: "stemsPanel.line.row",
                left: {
                    type: "text",
                    value: onLayer ? "Player" : onStem ? "Stem" : onRun ? "Separation" : onSaved ? "Saved stem" : "",
                    bold: true,
                },
                shortcutIds: [
                    ...(onLayer
                        ? ["stemsPanel.playPause", "stemsPanel.pick", "stemsPanel.mute"]
                        : cursorFile
                          ? ["stemsPanel.playPause"]
                          : []),
                    ...(cursorFile ? ["stemsPanel.reveal"] : []),
                    ...(onLayer && mixLoaded ? ["stemsPanel.seekBack", "stemsPanel.seekForward"] : []),
                    ...(onStem ? ["stemsPanel.pick"] : []),
                    ...(onRun ? ["stemsPanel.pick"] : []),
                    ...(canSave && (onStem || onRun || onSaved) ? ["stemsPanel.save"] : []),
                    ...(onRun || onSaved ? ["stemsPanel.delete"] : []),
                ],
            },
        ],
    });

    /** The pointer used this tab: the keyboard comes with it (its shortcuts and hints), like the Download Sources tab. */
    function focusPanel() {
        if (activeWindow !== "secondaryPanel") focusSourcesPane("list");
    }

    // The list scrolls to keep the cursor in view; the wheel moves the cursor.
    const listRef = useRef<DOMElement>(null);
    useWheelTarget(listRef, (delta) => {
        focusPanel();
        moveCursor(delta > 0 ? 1 : -1);
    });

    const headerLines: React.ReactNode[] = [];
    if (!attrs) {
        headerLines.push(
            <Text key="none" color={theme.text.muted}>
                {selectedTask ? "An album or playlist has no stems: select one of its tracks." : "No track selected."}
            </Text>
        );
    } else {
        headerLines.push(
            <Box key="input" flexDirection="row" overflow="hidden">
                <Box width={8} flexShrink={0}>
                    <Text color={theme.text.muted}>Input</Text>
                </Box>
                <Text color={inputPath ? theme.text.primary : theme.text.muted} wrap="truncate-start">
                    {inputPath ? `${path.basename(inputPath)} · ${inputKind}` : "nothing yet: download the track first"}
                </Text>
            </Box>
        );
        const modelText = !engine.provider
            ? "stem separation is off (Settings → Stems)"
            : !engine.status
              ? "reading…"
              : !engine.status.installed
                ? "not installed (Settings → Stems → Install…)"
                : engine.models.length === 0
                  ? engine.loading
                      ? "reading the models…"
                      : "no model downloaded (Settings → Stems → Download models…)"
                  : `${modelLabel ?? "—"} · ${(engine.device ?? "").toUpperCase()}`;
        headerLines.push(
            <Box key="model" flexDirection="row" overflow="hidden">
                <Box width={8} flexShrink={0}>
                    <Text color={theme.text.muted}>Model</Text>
                </Box>
                <Text
                    color={engine.status?.installed && engine.models.length ? theme.text.primary : theme.status.warning}
                    wrap="truncate-end"
                >
                    {modelText}
                </Text>
            </Box>
        );
    }
    if (activity) {
        headerLines.push(
            <Text key="activity-title" color={theme.status.processing} bold wrap="truncate-end">
                {activity.title}
            </Text>,
            <ProgressLine key="activity" text={activity.text} fraction={activity.fraction} />
        );
    }
    if (engine.error) {
        headerLines.push(
            <Text key="error" color={theme.status.error} wrap="truncate-end">
                {engine.error}
            </Text>
        );
    }

    const listHeight = Math.max(1, height - HINT_BAR_HEIGHT - headerLines.length - 1);
    const cursorRowIndex = cursorRow ? rows.findIndex((r) => stemRowKey(r) === stemRowKey(cursorRow)) : 0;
    const offset = Math.max(0, Math.min(cursorRowIndex - Math.floor(listHeight / 2), rows.length - listHeight));
    const visible = rows.slice(offset, offset + listHeight);

    const playbackOf = (file: string | undefined) =>
        file && nowPlaying?.filePath === file ? (nowPlaying.isPaused ? "paused" : "playing") : undefined;

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
            paddingLeft={1}
            paddingRight={1}
        >
            {headerLines}
            <Box height={1} flexShrink={0} />
            <Box ref={listRef} flexDirection="column" height={listHeight} flexShrink={0} overflow="hidden">
                {attrs && rows.length === 0 ? (
                    <Text color={theme.text.muted}>No stems yet. Separate the track to see its stems here.</Text>
                ) : null}
                {attrs
                    ? visible.map((row) => {
                          const key = stemRowKey(row);
                          const isFocused = cursorRow !== undefined && key === stemRowKey(cursorRow);
                          const onClick = () => {
                              focusPanel();
                              setCursorKey(key);
                          };
                          if (row.type === "layersHeader") {
                              return (
                                  <SectionTitle
                                      key={key}
                                      text="PLAYER"
                                      note="the track and its stems played together: S solo · M mute"
                                  />
                              );
                          }
                          if (row.type === "layer") {
                              const layer = layers.find((l) => l.key === row.key);
                              if (!layer) return null;
                              const display = layer.kind ? stemKindRegistry.get(layer.kind) : undefined;
                              return (
                                  <WaveformLayer
                                      key={key}
                                      label={display?.label ?? "Track"}
                                      color={display?.color ?? theme.text.primary}
                                      path={layer.path}
                                      durationMs={layer.durationMs}
                                      positionMs={mixLoaded ? player.status.positionMs : undefined}
                                      mixLengthMs={mixLoaded ? player.status.durationMs : undefined}
                                      audible={isAudible(mix, layer.key)}
                                      muted={mix.muted.has(layer.key)}
                                      soloed={mix.soloed.has(layer.key)}
                                      main={layer.key === "original"}
                                      playing={mixPlaying}
                                      width={width - 4}
                                      isFocused={isFocused}
                                      isActive={isPanelActive}
                                      onSelect={onClick}
                                      onSeek={(fraction) => {
                                          focusPanel();
                                          setCursorKey(key);
                                          void stemPlayer.seekTo(taskId, layers, fraction, layer.durationMs ?? 0);
                                      }}
                                      onTogglePlay={() => {
                                          focusPanel();
                                          if (hasStems) void stemPlayer.togglePlay(taskId, layers);
                                      }}
                                      onToggleMute={() => {
                                          focusPanel();
                                          toggleMute(layer.key);
                                      }}
                                      onToggleSolo={() => {
                                          focusPanel();
                                          toggleSolo(layer.key);
                                      }}
                                  />
                              );
                          }
                          if (row.type === "savedHeader") return <SavedHeaderRow key={key} />;
                          if (row.type === "saved") {
                              const stem = attrs.savedStems?.[row.kind];
                              if (!stem) return null;
                              const cell = stemCellState(attrs, row.kind);
                              return (
                                  <SavedStemRow
                                      key={key}
                                      stem={stem}
                                      follows={cell.state === "saved" ? cell.follows : true}
                                      isFocused={isFocused}
                                      isActive={isPanelActive}
                                      playback={playbackOf(stem.path)}
                                      onClick={onClick}
                                  />
                              );
                          }
                          const run = runOf(row.runId);
                          if (!run) return null;
                          if (row.type === "run") {
                              return (
                                  <RunRow
                                      key={key}
                                      run={run}
                                      collapsed={collapsed.has(run.id)}
                                      stale={isStemRunStale(run, currentFingerprint, inputPath)}
                                      isFocused={isFocused}
                                      isActive={isPanelActive}
                                      onClick={onClick}
                                  />
                              );
                          }
                          const stem = run.stems.find((s) => s.kind === row.kind);
                          if (!stem) return null;
                          return (
                              <StemFileRow
                                  key={key}
                                  stem={stem}
                                  picked={isPickedRow(attrs, row)}
                                  savedFromThis={attrs.savedStems?.[row.kind]?.runId === run.id}
                                  isFocused={isFocused}
                                  isActive={isPanelActive}
                                  playback={playbackOf(stem.path)}
                                  onClick={onClick}
                              />
                          );
                      })
                    : null}
            </Box>
            <DynamicHintBar width={width - 4} isActive={isPanelActive} />
        </Box>
    );
};
