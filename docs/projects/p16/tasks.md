# P16 — Logging Revamp

## Goal

The logging system was functional but leaked across task boundaries and rendered poorly:

- **Cross-task pollution.** Logs were attributed to a task only when emitted through a task/service child logger (`logger.createChild({ task })`). Shared code logs through `globalLogger` — the cache decorator ([src/utils/cache.ts](../../../src/utils/cache.ts)), the `@SafeAction` decorator ([src/utils/decorators.ts](../../../src/utils/decorators.ts), which logs _every_ task error), URL parsing — landed as **global** logs and showed up in every task's view.
- **No uri context.** A log line gave no quick hint which track it belonged to.
- **Coarse filtering.** `LogPanel` showed all global logs in every task view, with no way to suppress them and no log-level filter.
- **Broken rendering.** Each log was forced into a `height={1}` box with `wrap="truncate-end"`; `details` were `JSON.stringify`'d onto one truncated line. The logger pre-colorized the message with `chalk`, embedding ANSI escapes into the stored `message` (and the on-disk `app.log`), corrupting width math and the log file. Control/special characters could break the terminal grid.

This project delivers per-task log isolation via `AsyncLocalStorage`, a truncated uri prefix per line, two new settings (log level + include-global toggle), and a robust multi-line renderer.

### Design decisions

- **Mechanism:** `AsyncLocalStorage`, mirroring the pattern already used in [src/utils/cache.ts](../../../src/utils/cache.ts) — no extra logger argument threaded through shared code.
- **Prefix:** plain bracket text, **truncated** (e.g. `[spotify::track::4rye8Zg…]`), level-colored — not a styled chip.
- **Unknown uri:** falls back to the track URL (`userInput.url` / `initialInput`).
- **Default log level:** `INFO` in the panel. The file transport keeps everything at `debug`.
- **Presentation moved to render time.** The logger now stores the **plain** message; the `[LEVEL]`/uri/`[service]` prefix and level color are applied by the panel. Keeps `app.log` ANSI-free and width math accurate.

---

## Tasks

### T16.1 — Task context via AsyncLocalStorage

**File:** `src/base/task/taskContext.ts` (new)

`runInTaskContext` / `getCurrentTask` over an `AsyncLocalStorage<Task>`, plus a `@TaskScoped()` method decorator that runs the wrapped method inside its task's context. `Task` is imported type-only to avoid a runtime cycle (`task.ts` → `logger.ts` → `taskContext.ts`).

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.2 — Logger: ambient task fallback + plain message

**File:** `src/base/logger/logger.ts`

- Resolve `task = this.metadata?.task ?? getCurrentTask()` and include it in the emitted metadata, so shared-code logs land under the right task.
- Store the plain `getString(message)` (dropped `chalk` coloring and the `[service]` prefix — both now applied by the panel). Removed the now-unused `setLogColor`/`chalk` import.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.3 — @TaskScoped on DownloadTask entry points

**File:** `src/flows/musicDownloadFlow/utils/downloadTask.ts`

`@TaskScoped()` applied as the **outermost** decorator (above `@SafeAction`) on `start`, `restart`, `startPrimaryMetadataFetching`, `startMetadataDiscovering`, `startSingleProviderSearch`, `startDownloads`. Decorators apply bottom-up, so `@TaskScoped` establishes context before `@SafeAction` runs — even `@SafeAction`'s `globalLogger.error` is attributed to the task.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.4 — Structured task uri

**Files:** `src/flows/musicDownloadFlow/types.ts`, `src/flows/musicDownloadFlow/utils/downloadTask.ts`

- New `TrackUriParts` type; `uri?: TrackUriParts` and `recognizedServiceKey?: string` added to `TrackDownloadTask` (the metadata-level `TrackUri` string brand is left untouched).
- `startPrimaryMetadataFetching` records `recognizedServiceKey` and a `uri` from the parsed URL id when available, then refines `uri` with the authoritative `platform`/`id` once primary metadata is fetched.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.5 — Task log label

**Files:** `src/base/task/task.ts`, `src/flows/musicDownloadFlow/utils/downloadTask.ts`

`Task.getLogLabel(): string | undefined` (base returns `undefined`). `DownloadTask` overrides it: `${platform}::${type}::${id}` when `uri` is known, else the input URL. The full string is returned; the panel truncates. Keeps `LogPanel` decoupled from flow types.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.6 — Settings: log level + include-global toggle

**Files:** `src/settings/appSettings.ts`, `src/settings/settingsStore.ts`, `src/settings/buildGlobalSettingsItems.ts`

- New top-level `logs` settings section: `logLevel` (default `INFO`) and `includeGlobalLogsInFocusedTask` (default `false`).
- `SettingsStore` persists the `logs` section (read/write/defaults); `deepMerge` backfills missing keys for old settings files.
- A "Logs" section in the global settings modal: a `select` for minimum log level and a checkbox for including global logs when a task is focused.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.7 — LogPanel rendering revamp

**Files:** `src/components/SecondaryPanel/logFormat.ts` (new), `src/components/SecondaryPanel/LogPanel.tsx`, `src/components/SecondaryPanel/SecondaryPanel.tsx`, `src/hooks/useAppSettings.ts` (new)

- `formatLogRows(log, width): LogRow[]` — pure helper turning one log into visual rows: `[LEVEL] [uri] [flow] [service] message` header, wrapped message continuations, and `util.inspect` `details` indented with `└ `/`  `. ANSI stripped (`strip-ansi`), residual control chars removed (`sanitizeInput`), tabs expanded, width-aware word + hard wrap (`wrap-ansi`), uri prefix truncated (`cli-truncate`).
- `LogPanel` switched from one-row-per-log to one-row-per-visual-line: flattens filtered logs into rows and applies the bottom-anchored scroll math (with "more above/below" indicators) over rows. Each row colored by level; continuation/detail rows dimmed. Scroll resets on width change.
- Filtering: level threshold + task isolation (this task's logs, plus global logs only when the toggle is on; everything when no task is focused). Settings read live via the new `useAppSettings` hook. Panel width threaded from `SecondaryPanel`.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.8 — Dependencies

**File:** `package.json`

Promoted `cli-truncate`, `strip-ansi`, `wrap-ansi` to explicit runtime dependencies (previously transitive via ink).

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.9 — Docs

**Files:** `docs/projects/p16/tasks.md` (this file), `docs/projects/README.md`

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.10 — Log transport: level case normalization

**File:** `src/base/logger/ink-transport.ts`

Winston normalizes log levels to lowercase internally, but the `LogLevel` enum uses uppercase strings (`INFO`, `DEBUG`, etc.). The ink transport now uppercases `info.level` before pushing entries to `history` and `pending`, so level comparisons in `LogPanel` work without defensive casing at read time.

| Status     |
| ---------- |
| ✅ Done    |

---

### T16.11 — Delete confirm bridge

**File:** `src/base/flow/deleteConfirmBridge.ts` (new)

A thin module-level bridge that lets non-UI flow code trigger a delete-confirmation modal without a direct component dependency. Flow code calls `deleteConfirmBridge.request({ taskCount, apply })`; the UI registers a handler via `deleteConfirmBridge.setOpener(fn)`. Decouples the confirmation UI from the deletion logic.

| Status     |
| ---------- |
| ✅ Done    |

---

## Verification

| Check                  | Action                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Types / lint / format  | `yarn type-check`, `yarn lint`, `yarn format:check` clean                                                                                        |
| Build                  | `yarn build` (tsup) succeeds — validates ESM imports of the new helpers                                                                          |
| Isolation              | `yarn dev`, two tasks; focus task A → only A's lines (and `@SafeAction` errors attributed to A, not global)                                       |
| Include-global toggle  | Enable **Include global logs when a task is focused** → genuinely global lines reappear in the focused view; disable → they don't                 |
| No task focused        | Focus the toolbar → all logs show                                                                                                                |
| Prefix                 | Each task line prefixed with truncated `[platform::track::id]`; before recognition / on failure it falls back to the truncated URL                |
| Level                  | Set level ERROR → only errors; DEBUG → debug lines appear. `app.log` keeps all levels and is free of ANSI escapes                                 |
| Rendering              | Log newlines, very long text, JSON `details`, emoji/CJK/ANSI/control chars → content shown across wrapped rows, `details` indented, grid intact   |
