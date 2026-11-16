# P3 — Import System: Tasks

## Context

**Previous import flow (replaced):**

1. User selected the "Import" toolbar button and pressed `Enter`
2. `MusicDownloadFlow.importTasks()` read `inputs.txt` from the project root
3. Each non-empty, non-comment line became a `DownloadTask` with ID `item-0`, `item-1`, ...
4. `orchestrator.addTasks()` threw if any task ID already existed

**Problems (now fixed):**

- Sequential IDs (`item-0`, `item-1`) broke on re-import — collided with existing tasks
- `orchestrator.addTasks()` threw on duplicate instead of skipping
- `inputs.txt` was a dev artifact with a hardcoded file path — no user-facing flow
- `useImportButton` registered its own `useInput` hook (extra `setMaxListeners`)

**Current import flow:**

1. `Ctrl+V` anywhere on the main screen, or the Import toolbar button, triggers the flow
2. On most terminals: the keystroke is intercepted and clipboard is read via `readClipboard()`
3. On Windows Terminal (and others that intercept `Ctrl+V`): the pasted text arrives directly
   as a raw multi-char stdin chunk — detected by `input.length > 8 && /https?:\/\//i` and
   routed without a clipboard read
4. `detectUrls()` extracts and classifies all supported platform URLs from the text
5. A confirmation modal lists the detected URLs with platform badges
6. A 3-option radio selector lets the user choose the import action
7. `[Enter]` confirms; `[↑↓]` or `[Tab]` navigates; `[Esc]` cancels
8. Additional pastes while the modal is open append new URLs to the existing list
9. On confirm: `createTasksFromUrls()` builds typed `Task[]`, then `importTasks()` deduplicates and adds them

---

## Tasks

### T3.1 — Switch task IDs from sequential integers to URL-based hashes ✅

**Implemented:** `src/flows/musicDownloadFlow/utils/taskId.ts`

```typescript
import { createHash } from "crypto";

export function taskIdFromUrl(url: string): string {
    return "task:" + createHash("sha1").update(url).digest("hex").slice(0, 12);
}
```

Used in `MusicDownloadFlow.createTasksFromUrls()`. Same URL always produces the same ID,
enabling reliable duplicate detection across re-imports.

_Depends on: nothing_

---

### T3.2 — Clipboard read utility ✅

**Implemented:** `src/utils/clipboard.ts`

```typescript
export async function readClipboard(): Promise<string>;
```

Platform-aware (`win32` → `powershell Get-Clipboard`, `darwin` → `pbpaste`,
Linux → `xclip`). Catches all errors and returns `''`.

**Note:** In practice, Windows Terminal intercepts `Ctrl+V` and delivers clipboard
text as raw stdin before the keystroke ever reaches the app. `readClipboard()` is
the fallback for terminals that do forward the keystroke.

_Depends on: nothing_

---

### T3.3 — URL detection and platform parsing utility ✅

**Implemented:** `src/utils/detectUrls.ts`

```typescript
export type SupportedPlatform =
    "spotify" | "youtube" | "youtubeMusic" | "soundcloud" | "deezer" | "appleMusic" | "tidal";

export type DetectedUrl = {
    raw: string;
    platform: SupportedPlatform;
    type: "track" | "album" | "playlist" | "unknown";
};

export function detectUrls(text: string): DetectedUrl[];
```

Extracts all URLs with `/https?:\/\/[^\s"'<>]+/gi`, then classifies each via `classify()`.
Unknown URLs (no matching platform) are excluded. Spotify album/playlist paths are
classified accordingly; SoundCloud homepage is excluded.

_Depends on: nothing_

---

### T3.4 — Import state management and duplicate filtering ✅

**Deviation from plan:** Import state was originally planned for `App.tsx`. It now lives in
`src/hooks/useImportFlow.ts`, which owns state and all three import callbacks
(`openImportFlow`, `handleImportConfirm`, `handleImportCancel`). `App.tsx` and `AppInner.tsx`
are not aware of `PendingImport`.

**`PendingImport` type** (in `src/components/ImportModal.tsx`):

```typescript
type PendingImport = {
    urls: DetectedUrl[];
    fetchMetadata: boolean;
    download: boolean;
};
```

**Duplicate filtering** moved to `FlowBase.importTasks()` (see T3.8 deviation). Deduplication
checks both the orchestrator's existing task IDs and a within-batch `seen` set.

**Continuous link handling (post-P3 addition):** When the modal is already open, additional
pastes merge new URLs into the existing list instead of being dropped. Deduplication is by
raw URL string. The stdin paste check in `InputRouter` runs _before_ the modal guard so it
fires even when the modal has focus.

_Depends on: T3.1, T3.3_

---

### T3.5 — ImportModal component ✅

**Implemented:** `src/components/ImportModal.tsx`

**Deviation from plan:** The two checkboxes (Fetch Metadata? / Download?) were replaced with
a 3-option radio selector navigated by `[↑↓]` / `[Tab]`:

```
  ☛ Fetch Metadata & Download
    Fetch Metadata
    Do nothing
```

`[Enter]` confirms the selected option. `[Esc]` cancels. The selected option maps to
`{ fetchMetadata, download }` passed to `onConfirm`.

**URL list limits (post-P3 addition):**

- Maximum 32 URLs displayed; excess shown as `and N other URLs...`
- If the list would overflow the terminal height, it is trimmed earlier (before the 32nd),
  always reserving one row for the overflow line

**Focus management:** `switchWindow('importModal')` on mount, `switchBack()` on unmount,
via `useFocusContext()`. `useInput` is gated with `{ isActive }`.

_Depends on: T3.3, T3.4, P1/T1.2_

---

### T3.6 — Wire `Ctrl+V` as a global import shortcut ✅

**Implemented:** `src/components/InputRouter.tsx` + `src/hooks/useImportFlow.ts`

Two detection paths in `InputRouter.useInput`:

1. **stdin paste** (checked first, before the modal guard so it works while modal is open):

    ```typescript
    if (input.length > 8 && /https?:\/\//i.test(input)) {
        openImportFlow(input);
        return;
    }
    ```

2. **Ctrl+V keystroke** (fallback, blocked by modal guard):
    ```typescript
    if ((key.ctrl && (input === "v" || input === "V")) || input === "\x16") {
        openImportFlow();
        return;
    }
    ```

`openImportFlow(text?)` in `useImportFlow`: if `text` is provided, skips clipboard read;
otherwise calls `readClipboard()`. Guards: no-op if `focusState.activeWindow === 'prompt'`.

_Depends on: T3.2, T3.3, T3.4, T3.5_

---

### T3.7 — Redirect the Import toolbar button to the clipboard flow ✅

**Implemented:** `src/flows/musicDownloadFlow/toolbar/useImportButton.ts` +
`src/contexts/ImportActionsContext.tsx`

`useImportButton` no longer calls `flow.importTasks()` directly. It reads `openImportFlow`
from `ImportActionsContext`:

```typescript
export const useImportButton: ToolbarButtonHook<FlowBase> = () => {
    const { openImportFlow } = useImportActions();
    return { label: "Import", icon: "⮯", ..., onPress: () => openImportFlow() };
};
```

`ImportActionsProvider` wraps `AppInner` and passes `openImportFlow` down via context,
avoiding prop-drilling through the toolbar stack.

_Depends on: T3.6_

---

### T3.8 — Remove the `inputs.txt` import mechanism ✅

**Implemented as planned**, with one architectural deviation:

**Deviation:** The plan said to keep `FlowBase.importTasks(urls, opts)` and rename
`addUrlsAsTask()` to `importTasks()`. Instead, the interface was split into two methods:

- `FlowBase.createTasksFromUrls(urls, opts): Task<TaskAttributes>[]` — flow-specific factory;
  `MusicDownloadFlow` implements this to build `DownloadTask[]` with `toTag`, `toDownload`,
  and `userInput` already set
- `FlowBase.importTasks(tasks: Task<TaskAttributes>[])` — generic base implementation;
  handles deduplication and `orchestrator.addTasks()`. No override needed in `MusicDownloadFlow`

`useImportFlow.handleImportConfirm` calls both in sequence:

```typescript
const tasks = currentFlow.createTasksFromUrls(urls, { toTag: fetchMetadata, toDownload: download });
currentFlow.importTasks(tasks);
```

**Also removed:**

- `src/flows/musicDownloadFlow/utils/input-loader.ts` — deleted
- `InputLoader` import and `static inputLoader` field from `MusicDownloadFlow`

`inputs.txt` is kept in the repo root as a local dev reference but is no longer read by the app.

_Depends on: T3.7_

---

## Summary

| Task | What                                                   | Status  |
| ---- | ------------------------------------------------------ | ------- |
| T3.1 | URL-based task IDs (`task:<sha1[:12]>`)                | ✅ Done |
| T3.2 | `readClipboard()` utility                              | ✅ Done |
| T3.3 | `detectUrls()` with platform classification            | ✅ Done |
| T3.4 | Import state in `useImportFlow` hook + dedup           | ✅ Done |
| T3.5 | `ImportModal` with 3-option radio selector             | ✅ Done |
| T3.6 | `Ctrl+V` + stdin paste detection in `InputRouter`      | ✅ Done |
| T3.7 | Import toolbar button via `ImportActionsContext`       | ✅ Done |
| T3.8 | Removed `inputs.txt` path; split `FlowBase` import API | ✅ Done |
| —    | Continuous link handling (append to open modal)        | ✅ Done |
| —    | URL list display limit (32 + overflow line)            | ✅ Done |
