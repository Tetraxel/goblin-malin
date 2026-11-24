# P33 — Stem Separation: Tasks

> **Status: first version built** (2026-11-23). See [What was built](#what-was-built) for what differs from the plan and what is left.

## What was built

T33.1 – T33.9 as one change. Where it differs from the plan, or leaves something out:

- **Engine** (`services/stem-providers/audioSeparator/`): `uvSetup.ts` downloads the pinned uv (0.13.9) and refuses it without its published SHA-256 (zip on Windows through `installFromZip`, the `.tar.gz` with the system `tar` elsewhere). `engine.ts` installs `audio-separator[gpu|cpu]==0.48.0 --with audioread` into `<data>/stems/` (`tools/`, `python/`, `cache/` cleaned after the install, `models/`, `install.json`), lists models (cached in `stems/models.json`, read again on "refresh"), downloads / removes one, and separates: into a `.separating-<uuid>` folder inside the temp folder, under the program's own names, then each `…_(Vocals)_<model>.flac` is renamed to `Stems <artist - title> <run uuid>.<stem>.flac` (the app's temp signature, so "Clear temporary downloads" groups a run's stems). `--custom_output_names` is not used: a model whose stems the list does not give (most Roformers) would not be named. ffmpeg reaches the program through `stems/ffmpeg/` (hard links to the app's copies), first on the child's PATH; the CPU is chosen with `CUDA_VISIBLE_DEVICES=-1`. A stall of 10 minutes without output ends a run; the stop and closing the app kill the process tree. **Checked for real** (the app's engine code against the spike install): 169 models listed in 4.5 s, a 30 s clip separated on CUDA in 16.6 s (model load included), a CPU run stopped after 9 s left no file and no process.
- **Settings → Stems** (`buildFlowSettingsItems.ts`, a section like MusicBrainz): the stem set of the view (2 / 4 / 6 stems), the file name template, tag the stems, save them with the track; then the provider's own rows: enable (off), "Run on" auto / cuda / cpu, the install status, Install / Reinstall (the confirm names the NVIDIA card found and the size), Download models… (the list opens at once and fills in; a downloaded model offers to delete it), Default model…, Uninstall. The plan's "output format" setting was left out: stems are saved in the format tracks are converted to (FLAC by default).
- **Data and methods** as planned (`stemRuns`, `stemPick`, `savedStems`), plus `restoreStemPick` (the undo of Claude's `pick_stem`) and `forgetSavedStem`. `startStemSeparation` answers once the run is queued (`{ run, done }`). `stemRunning` counts in `isBusy()`, so Claude's writes wait for a separation of the same track, like for a download. "Relocate" for a saved stem was not built (a stem deleted or moved shows "file not found"; Del forgets it).
- **UI**: the tab lines are built from `TabDef.shortcutId` and show the live binding (`useShortcutLiterals`), not a typed number. The shortcuts are `global.metadataView` … `global.logsTab`; settings file v4 moves a user's own keys from the old `global.mode1` … `global.tab5`. The Stems tab is one list (saved stems, then runs newest first with their stems), not the Download tab's list + detail split; its keys: ↑/↓, Space play, Enter use this file (on a run: fold), R separate / stop, M model (this tab only; Settings has the default), S save the stem or run under the cursor, A save all, Del delete a run (asks) or forget a saved stem, N rename to match, O show in folder. A stem column of the view offers Play stem (Enter, also a click on the cell), Separate stems (B on the task row, works on a multi-selection) and Save stems (A). Playing several stems together (`mpvMix.ts`) was not built.
- **Claude**: `list_stem_models`, `get_stems` (read), `separate_stems` (confirm, max 10 tracks per call, "don't ask again" lasts the conversation: `runAllowance.stems`), `stop_stems`, `pick_stem` (undoable). `get_task` has a `stems` summary, `wait_for_tasks` waits for a separation, `assessTask` flags a failed one. No tool installs, downloads a model or saves (the catalogue test forbids `save_stems` / `install_stems`).
- **Tests**: `tests/unit/stems.test.ts` (the output parser on the spike's real lines, the model list, file names, picks and cell states, missing temp stems, revived runs, and a `DownloadTask` driven by a fake provider: busy while separating, Stop, refusals, saving next to the track, a restart that keeps runs / picks / saved stems, deleting a run); the settings migration; `scripts/tui-test/examples/stems-view.json`. The committed fixtures have no stems (their paths are absolute): the filled Stems tab was checked with a scratch copy of `showcase`.

## Context

A saved track can be split into **stems**, the separate parts of the mix: by default **4 stems** (vocals, drums, bass, other). Nothing in the app does this today.

**The engine** is [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator), the command-line and library form of the engine behind [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui). It runs the same model families (Demucs, MDX-Net, MDX23C, VR, BS-/Mel-Band RoFormer) and downloads the models itself. UVR's GUI cannot be driven from another program, so it is not an option. Which model is best changes often (the [MVSEP](https://mvsep.com) leaderboards follow it), so **the user chooses which models to download and which one to run**. The app never fixes the choice.

What must hold:

- **Off by default.** Nothing is downloaded until the user turns the feature on and confirms. The install is large: PyTorch with CUDA is about 2–3 GB, and each model is 100–600 MB.
- **On request only.** Separation is **not a pipeline stage**. Running a track (metadata → discovery → download) never separates it. The user starts it, or asks Claude to.
- **Not hardcoded.** The separator is a provider in its own registry, like the download providers. Stem kinds come from the model, not from the components.
- **The user's files are the user's.** A stem saved to the library is a record like `savedFile`: no restart, re-run or new separation removes it.

## What the user sees

### Top panel: a new primary mode, "Stems view"

The tab line above the task list gets a third mode next to `Metadata view` / `Download view`:

```
├──  [1] Metadata view  [2] Download view  [3] Stems view ─────────────────────────────
  Artist          Track                 Vocals      Drums       Bass        Other
  Daft Punk       Around the World      ● saved ▶   ● saved     ◐ temp      ✕ missing
  Justice         Genesis               ⠋ 42 %      ⠋ 42 %      ⠋ 42 %      ⠋ 42 %
  Air             La femme d'argent     —           —           —           —
```

- **One column per stem kind** of the stem set chosen in Settings (4 by default). The columns come from the stem-kind display registry (T33.3), never from a list written in a component.
- **States in a cell:** `—` not separated · progress while separating · **separated** (a temporary file, not in the library yet) · **saved** (in the library next to the parent file) · **file not found** (a saved or temporary stem that disappeared from disk) · **failed** · **stale** (made from a file the track has replaced since, see T33.2).
- **Preview:** the cell under the cursor plays its stem with the existing player (`useFilePlayback` / `PlaybackBar`, mpv), with the same shortcut as a download preview. `▶` marks the one playing.
- Contextual actions in the list: _Separate stems_, _Save stems_, _Open folder_. The Actions menu gets _Separate stems of the selected tracks_.

### Bottom panel: a new "Stems" tab

The secondary panel gets a tab next to `Metadata Sources` / `Download Sources` / `Logs`. It is built from the parts of the Download Sources tab (`DownloadSourceTree`, `SavedFileRow`, `SourceFileRow`, `PlaybackBar`, `StateBadge`):

```
├─┴──  [4] Metadata Sources  [5] Download Sources  [6] Stems  [7] Logs ───────────────
  Input   ● Daft Punk - Around the World.flac  (saved file, FLAC 16/44.1)
  Model   htdemucs_ft  ▾      Device  CUDA (RTX 3080)      [ Separate ]  [ Save all ]

  ▾ htdemucs_ft · 2026-11-23 14:02 · 38 s
      Vocals   ● saved   Daft Punk - Around the World (Vocals).flac         ▶
      Drums    ● saved   Daft Punk - Around the World (Drums).flac
      Bass     ◐ temp    not saved                                   [ Save ]
      Other    ✕ saved file not found: …\Around the World (Other).flac  [ Save again ]
  ▸ BS-Roformer-SW · 2026-11-23 13:40 · 2 min 10 s     (3 stems used: Drums, Bass, Other)
```

- **Input:** which file is separated. The saved file if there is one, otherwise the selected download (its stems are saved when the track is saved, or by hand).
- **Options:** the model (only the downloaded ones; "Download more models…" opens the list in T33.4), the device (CUDA / CPU) and model-specific options that are worth exposing (e.g. Demucs `shifts`, MDX `overlap`). Their defaults come from Settings.
- **Runs:** each separation is one **run** (model + date + duration), shown as a group like a download provider. Running another model adds a run and keeps the earlier ones, so the user can **compare models per stem by ear** and **pick, per stem, which run's file is the one kept** (the same thing as picking a download source). By default the newest run is picked.
- **What is on disk:** every stem row says whether its file is saved, temporary only, or **not found**, with its path and what it was probed as. A stem can be saved while the others are not. _Save_, _Save all_, _Save again_, _Reveal in folder_, _Delete temporary files of this run_ (asks).

### File names

Stems follow the parent file: **the same folder and base name plus a suffix per stem**, in the output format of Settings → Download (FLAC by default):

```
Daft Punk - Around the World.flac
Daft Punk - Around the World (Vocals).flac
Daft Punk - Around the World (Drums).flac
…
```

The suffix is a template in Settings (`{name} ({Stem})` by default; `{name} - {stem}`, a `Stems/` subfolder…). If the parent file is renamed or moved later (saved again under another name, relocated), the stems are shown as **"name does not follow the track"** with a _Rename to match_ action. Nothing is renamed without the user asking. Stems are tagged with the parent's tags, with the stem's name appended to the title (Settings: on/off).

## Architecture

```
 Stems tab / Stems view / Claude tool
        │  (on request only)
        ▼
 DownloadTask.separateStems(model, options)   ── trackStemRun (own stop, isBusy) ── stem limiter (1 at a time by default)
        │
        ▼
 stemServiceRegistry ──► AudioSeparatorService (first provider)
        │                    │
        │                    ├─ uv (single binary in bin/, checksum-verified) — manages its own Python
        │                    └─ audio-separator (uv tool, CPU or CUDA build) in <data>/stems/
        ▼
 TrackDownloadTask.stemRuns[]   (rebuilt by the user's own runs only)
 TrackDownloadTask.savedStems   (library files: never cleared by any reset)
```

- **Why `uv`:** it is a single file (like ffmpeg), fetches its own Python, and installs audio-separator into a folder the app owns (`UV_TOOL_DIR`, `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR` all under the data folder). The user needs no Python, and their own Python is never touched. Uninstall = delete the folder.
- **GPU:** detect an NVIDIA card (`nvidia-smi`), install `audio-separator[gpu]` with the matching CUDA PyTorch wheel; otherwise `[cpu]`. The device is a setting; CUDA falls back to CPU with a log line if it fails.
- **The process:** started like yt-dlp: `registerAgentCleanup(() => killProcessTree(child))`, its stop is the task's own (`task.abortRun()`), and the environment is the scrubbed one (`appSecrets` already removed the credentials). There is no total timeout (a CPU run can take minutes), but a **stall timeout**: no progress line for N minutes ends it.
- **Progress:** read from audio-separator's progress output (tqdm) through `lineSplitter.ts`, shown every 300 ms at most (one frame per update rule).

### Data model (`types.ts`)

```ts
type StemKind = string; // "vocals" | "drums" | "bass" | "other" | … — declared by the model, displayed through the registry

type StemFile = {
    kind: StemKind;
    tempPath?: string;               // what the run wrote (temp folder)
    localState?: "found" | "not_found";
    fileInfo?: FileInfo;             // probed
};

type StemRun = {
    id: string;                      // stable key (provider + model + startedAt), never an index
    provider: string;                // stemServiceRegistry key
    model: string;
    options: Record<string, unknown>;
    input: { path: string; kind: "saved" | "download"; fingerprint: string }; // size + mtime: the stale check
    state: "queued" | "separating" | "done" | "failed" | "stopped";
    progress?: number;
    error?: string;
    startedAt?: Date; finishedAt?: Date;
    stems: StemFile[];
};

type SavedStem = {                   // like SavedFile: a record of a file in the user's library
    kind: StemKind;
    path: string; writtenPath?: string; savedAt: Date;
    runId: string; model: string; fileInfo?: FileInfo;
};

// on TrackDownloadTask
stemRuns?: StemRun[];
stemPick?: Record<StemKind, string>; // runId the user picked per stem (absent = newest run)
savedStems?: Record<StemKind, SavedStem>;
```

- `savedStems` and `stemPick` are **user data**: no reset path (`restart()`, `start()` from stopped, `runSelected()`, a new download) empties them. `stemRuns` only changes when the user separates again or deletes a run (both ask when files would be lost). Covered by `tests/unit/userSources.test.ts`-style tests.
- A stem run is found again by its `id`, never by its position (same rule as `rowKey`).
- `computeTaskRevision` includes `stemPick` (Claude can write it).

## Spike results (T33.1, 2026-11-23): go

Measured on Windows 11, RTX 3080 (10 GB), uv 0.13.9, audio-separator 0.48.0:

- **Install:** `uv tool install "audio-separator[gpu]==0.48.0" --with audioread --python 3.12 --torch-backend auto` with `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`, `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR` in one folder and `UV_PYTHON_PREFERENCE=only-managed`, `UV_NO_CONFIG=1`: **43 s**. uv picked `torch 2.15.0+cu132` itself (`--torch-backend auto`; `cpu` for the CPU build). On disk: the tool environment 3.6 GB, its Python 63 MB, uv's cache 3.6 GB (cleaned after the install).
- **`--with audioread` is required:** 0.48.0 imports `audioread` without declaring it (newer `librosa` stopped pulling it in), and every command fails without it.
- **ffmpeg must be on PATH:** the program refuses to start without an `ffmpeg` it can find on PATH, even with `--use_soundfile`. The app gives it its own ffmpeg: a folder holding `ffmpeg.exe` / `ffprobe.exe` (hard links to the versioned copies in `bin/`) first on the child's PATH. Checked with a PATH holding nothing else.
- **Models:** `--list_models --list_format json` gives `{ VR | MDX | Demucs | MDXC: { "<friendly name>": { filename, stems[], target_stem, scores, download_files[] } } }`. No sizes. 4-stem models: **Demucs v4 `htdemucs_ft`, `htdemucs`, `hdemucs_mmi`**, plus `htdemucs_6s` (6 stems). Many Roformer entries list no stems (`BS-Roformer-SW.ckpt`, a 6-stem model, is one): their stems are only known after a run. `--download_model_only -m <filename> --model_file_dir <dir>` downloads one. `htdemucs_ft` is 4 × 84 MB.
- **Separation:** a 3 min 28 s FLAC with `htdemucs_ft` on CUDA: **39 s** of separation (+8 s to load the model, +16 s to download it the first time). On CPU (`CUDA_VISIBLE_DEVICES=-1`): **104 s for a 30 s excerpt**, so ~12 min per track. Output: 44.1 kHz, 24-bit FLAC (the input's depth).
- **Names:** `--custom_output_names '{"Vocals":"…","Drums":"…"}'` sets each output's base name (the keys are the stems' capitalised names). Without it: `<input>_(Vocals)_<model>.flac`.
- **Progress:** stderr has tqdm bars, `\r`-separated: downloads in bytes (`84.1M/84.1M [..., 54.1MiB/s]`), separation passes in iterations (`36/36 [00:03<00:00, 10.06it/s]`; `htdemucs_ft` makes 12 passes on that track), and INFO lines (`Loading model`, `Separation duration`, `Separation complete! Output file(s): …`).
- **Stop:** killing the process tree (`audio-separator.exe` → `python.exe` → `python.exe`) ends everything and leaves no output file.
- **Licences:** audio-separator is MIT. Demucs' weights are MIT (Meta). The community Roformer weights carry their authors' terms: the app only downloads a model when the user picks it, and shows the model's name and author.

## Tasks

### T33.1 — Spike (go/no-go) on Windows + RTX 3080 — done, see above

In a scratch folder, not in the app:

- Install `uv`, then `uv tool install "audio-separator[gpu]"` with CUDA PyTorch, all under one folder. Note: **disk size**, **time**, what is downloaded from where (for `SECURITY.md`), and the same for `[cpu]`.
- `audio-separator --list_models` (JSON format): does it give the stems of each model, the size, a 4-stem flag? Which 4-stem models exist today (`htdemucs`, `htdemucs_ft`, multi-stem RoFormers…)?
- Separate one 4-minute FLAC with 2–3 four-stem models: **time on CUDA vs CPU, VRAM**, output names. Check that the output names can be set (`--custom_output_names` or equivalent) and that the output format/bit depth can be FLAC 16/24.
- The progress lines: can they be parsed reliably? Does `killProcessTree` stop a run cleanly (no orphaned Python, no half-written files)?
- **Licences:** the program is MIT. Check each model's weights licence (some are non-commercial). Only list the ones the app can offer.
- Decide: go / no-go, `uv` vs alternatives, the list of models to offer first. Write the numbers into this file.

### T33.2 — Data model and task methods

- Types above in `types.ts`. Sessions save/load them (`reviveTaskDates` for the dates; a run saved as `separating` comes back as `stopped`).
- `DownloadTask` named methods (the panels and Claude both call them, through `assertWritable` / `runUserEdit`): `separateStems({ model, options, input? })`, `stopStems()`, `pickStem(kind, runId)`, `saveStems(kinds?)`, `deleteStemRun(runId)` (asks first through `dialogBridge.confirm` when temporary files would be lost), `relinkSavedStem(kind, path)` (relocate), `renameStemsToMatch()`.
- `trackStemRun`: like `trackPartRun`, with its own stop reached by `abortRun()` and counted in `isBusy()` (a track being separated cannot be deleted, archived or swapped). It does not block metadata edits.
- A stem limiter in `stageLimiters.ts` (`maxParallelSeparations`, default 1: one GPU).
- **Stale:** a run whose `input.fingerprint` no longer matches the track's current input file is shown as stale ("made from an older file").
- **Missing files:** `missingLocalFiles.ts` also marks stems (temporary and saved) that are gone; the temp cleanup (`tempCleanup.ts`, `tempCleanupFlow.ts`) knows the stems' temporary files.
- Tests: resets keep `savedStems`/`stemPick`; stop ends the run and leaves no busy task; a run is found by id after the list changes; stale and missing detection.

### T33.3 — The stem-separator registry and the stem kinds

- `stemServiceRegistry` in `registries.ts`, base class `StemSeparationService` (`stemService.ts`), one `register()` in `initMusicApp()`.
- What a service declares (read generically, never branched on): `static display`, `static summary`, `defaultSettings` (`enabled` false), `static setupWizard`/`consent` if it ever sends audio to a third party (a future cloud provider), `settingsRows` / `settingsStatus`. Instance methods: `isInstalled()`, `install(options, signal, onProgress)`, `uninstall()`, `listModels(): StemModel[]` (name, family, stems, size, installed, licence), `installModel(name, signal, onProgress)`, `removeModel(name)`, `separate(input, model, options, outDir, signal, onProgress): StemFile[]`.
- **Stem kinds:** a small display registry (`stemDisplay.ts`, like `providerDisplay.ts`): label, acronym, colour for `vocals`, `drums`, `bass`, `other`, `guitar`, `piano`, `instrumental`, with a generic fallback for an unknown kind a model declares. The stem set (Settings → Stems: "4 stems" default) decides the columns.
- Update `CLAUDE.md` (Provider extensibility) and `docs/ARCHITECTURE.md` (a fourth registry).

### T33.4 — `AudioSeparatorService`: install, models, separation

- `uv` download in `bin/` like ffmpeg (`binaryArchive.ts`, `binaryFiles.ts`, `checksum.ts`, `withBinaryAlert.ts`, `fetchWithTimeout`). Pinned version, checksum verified.
- **Install** (Settings → Stems → "Install…", a `settingsRows` action): `dialogBridge.confirm` with the size and what is downloaded, safe button first; CPU or CUDA, with the detected card preselected; progress in the settings row and the log. Nothing is installed by the feature switch alone. **Uninstall** removes the folder (asks).
- **Models** ("Download models…"): `dialogBridge.choose` with `body: Promise<…>` (the dialog opens at once with a loader while `--list_models` runs), showing the model's stems, size, family and whether it is downloaded. Only the 4-stem models are shown by default (a filter shows the others). Separation only uses downloaded models: no silent download of hundreds of MB.
- `settingsStatus` reads the sizes on disk (install folder, each model) in the background, never in render.
- `separate()`: writes into a temp folder per run, names set by the app (T33.1), FLAC by default; probes the results (`probeAudio.ts`); a stall timeout; the stop kills the process tree and deletes the partial files.
- Tests: the command line built for CPU / CUDA / a model, progress parsing, the stop, a failed run's error text (CUDA out of memory, missing model).

### T33.5 — Saving stems next to the parent file

- `computeStemPath(parentPath, kind, template)`, using the same file-name cleaning as `computeOutputPath.ts`; conversion through `convertAudio.ts` when the run's format is not the saved format; tags copied from the parent (`tagAudioFile.ts`) with the stem in the title when Settings says so; written through `writeViaStaging.ts`.
- A stem made from a download (no saved file yet) is saved when the track is saved, if the setting "Save stems with the track" is on (default on), or by hand.
- Overwriting a file the track does not own asks (`isOutputPathTaken`), as for the track.
- "Name does not follow the track" + _Rename to match_ when the parent's path changed.
- Tests: paths for each template, a parent saved again under another name, a relocated parent, a missing parent.

### T33.6 — Stems view (top) and Stems tab (bottom)

- `PrimaryMode` gains `"stems"`; `computeColumns("stems")` gives Artist, Track, then one `StemCell` per stem kind of the set. The cell reads only its own task (performance rules: no subscription to every task).
- **Tabs and shortcuts:** top `[1] Metadata view [2] Download view [3] Stems view`, bottom `[4] Metadata Sources [5] Download Sources [6] Stems [7] Logs`. The tab shortcuts are stored as `global.tab1`…`global.tab5`, so **give them names** (`global.metadataView`, `global.downloadView`, `global.stemsView`, `global.metadataSourcesTab`, `global.downloadSourcesTab`, `global.stemsTab`, `global.logsTab`) and migrate the user's overrides once. `TabBar` writes `[${tab.key}]` itself today: make it show the live binding of the tab's shortcut id (shortcuts rule).
- `StemsPanel` in `SecondaryPanel/StemsPanel/`: input line, options line (model, device, model options), Separate / Stop / Save all buttons, the run tree (reuse `DownloadSourceTree`'s parts and `treeWindow.ts`), per-stem rows with state, path, file info, preview, Save / Save again / Reveal / Pick.
- Every new key is registered with `useShortcuts` (`stemsPanel.*`) and every hint uses `Hint` with a shortcut id. Mouse: rows and buttons clickable like the Download Sources tab.
- Contextual actions (`contextualActions.ts`) and an Actions menu item (`actionsMenuRegistry`): _Separate stems of the selected tracks_ (with the unavailable reason when the feature is off, not installed or has no model).
- Optional: **play several stems together** (e.g. an instrumental: drums + bass + other) with `mpvMix.ts`.
- Check the frame budget with the perf suite (`perfSuite.ts` / `perfCompare.ts`): a progress tick must not cost more than one frame per 300 ms, and moving the cursor in the Stems view must cost the same as in the Download view.
- A TUI harness scenario for the two tabs (`scripts/tui-test/`), with fixture tasks holding saved, temporary, missing and stale stems.

### T33.7 — Settings → Stems

Built from the service's `defaultSettings` and `settingsRows` (nothing written by hand in `SettingsModal`):

- Enable stem separation (off) · Install / Uninstall (action rows, status: installed version, size, CUDA/CPU) · Download models… · Default model · Device (Auto / CUDA / CPU) · Stem set (4 stems default) · File name template · Folder (next to the track / a subfolder) · Output format (follows Download by default) · Tag stems · Save stems with the track · Parallel separations (1).

### T33.8 — Claude's capabilities

Each tool is declared once with `defineAgentTool` in `agent/tools/stemTools.ts`, registered by `registerAgentTools()`, then `yarn run agent:tools --write`:

| Tool               | Kind    | What it does                                                                                                                                                                                                                                   |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_stem_models` | read    | The installed engine, the device, every model (downloaded or not, its stems, size, licence).                                                                                                                                                   |
| `get_stems`        | read    | A track's stem runs, the pick per stem, saved stems and what is on disk (missing, stale). Also a short `stems` field in `get_task`'s view.                                                                                                     |
| `separate_stems`   | confirm | Separate up to N tracks with a **downloaded** model, through `DownloadTask.separateStems`. Asks first (GPU minutes), starts in the background, answers at once. The "don't ask again for this conversation" choice works as in `run_download`. |
| `stop_stems`       | write   | Stop a running separation (`stopStems`).                                                                                                                                                                                                       |
| `pick_stem`        | write   | Choose which run's file is kept for one stem (`pickStem`; revision checked).                                                                                                                                                                   |

- **Not given to Claude:** installing the engine or downloading models (gigabytes, the user's choice in Settings), and saving stems to the music folder (P32's rule: Claude never saves to the library). Claude can say what to do and where.
- `wait_for_tasks` / `isTaskBusy` (`agent/runReport.ts`) counts a running separation; `assessTask` gives stem verdicts (failed run, a saved stem not found, stale stems).
- The agent's prompt says what stems are, that separation is slow and on request, and that a model must be downloaded first.
- Tests: the tools refuse a track being processed or held by someone else, a model not downloaded, the feature turned off; the catalogue test passes.

### T33.9 — Docs and release

- `README.md` (what a user gets, the size, GPU vs CPU), `SECURITY.md` (what is downloaded: uv, Python, PyTorch, models, and from where; nothing leaves the computer), `docs/ARCHITECTURE.md`, `CLAUDE.md`, `TODO.md`, `CHANGELOG.md` (Unreleased), `docs/agent-tools.md` (generated).
- Update the welcome tour / design screenshots if the tab lines change.

## Decisions

- **Engine:** python-audio-separator (UVR's engine, MIT), installed with `uv` into the data folder. Not the UVR GUI (no command line), not Demucs alone (one model family).
- **Off by default**, installed and models downloaded only when the user asks, with the size shown first.
- **Default: 4 stems** (vocals, drums, bass, other). The model decides the stems; the set in Settings decides the columns.
- **Never automatic:** no pipeline stage, no "Run all" effect. Separate is an action of the user or a `confirm` tool of Claude.
- **Several runs per track**, one pick per stem: compare models by ear.
- **Stems follow the parent file:** same folder, base name + suffix template, the saved format.
- **Saved stems are user data** (like `savedFile`): no reset removes them.

## Answered questions (2026-11-23)

- **Tab keys: renumbered** as above (`[3] Stems view`; `[4] Metadata Sources`, `[5] Download Sources`, `[6] Stems`, `[7] Logs`), with named shortcut ids and a one-time migration of the user's overrides.
- **Stems of a track with no saved file: allowed** from the selected download; they are saved with the track (or by hand).
- **No cloud provider.** python-audio-separator only. The registry stays generic, but nothing is planned for a service that uploads audio.

## Order

T33.1 (spike, go/no-go) → T33.3 + T33.2 (registry, data, methods) → T33.4 (install, models, separate) → T33.5 (save) → T33.7 (settings) → T33.6 (UI) → T33.8 (Claude) → T33.9 (docs).
