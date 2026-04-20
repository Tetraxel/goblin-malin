# P3 — Import System: Tasks

## Context

**Current import flow:**

1. User selects the "Import" toolbar button and presses `Enter`
2. `MusicDownloadFlow.importTasks()` reads `inputs.txt` from the project root
3. Each non-empty, non-comment line becomes a `DownloadTask` with ID `item-0`, `item-1`, ...
4. `orchestrator.addTasks()` is called — it **throws** if any task ID already exists

**Problems with the current approach:**

- Sequential IDs (`item-0`, `item-1`) break on re-import — a second import would create IDs that collide with the first
- `orchestrator.addTasks()` throws on duplicate, so re-importing crashes instead of skipping
- `inputs.txt` is a dev artifact with a hardcoded file path — it has no user-facing flow
- `useImportButton` registers its own `useInput` hook (another `setMaxListeners` contributor)

**Target import flow:**

1. `Ctrl+V` anywhere on the main screen (no modal open) reads the clipboard
2. App parses all valid URLs from the pasted text and identifies their platform
3. A confirmation modal appears listing the detected URLs with platform badges
4. Modal footer has two checkboxes: **Fetch Metadata?** and **Download?**
5. `[Enter]` confirms: tasks are created with `toTag`/`toDownload` set from the checkboxes
6. URLs already in the queue are silently skipped (logged)
7. `[Esc]` dismisses the modal with no changes

The Import toolbar button triggers the same clipboard-driven flow.

---

## Tasks

### T3.1 — Switch task IDs from sequential integers to URL-based hashes

**Current:** `DownloadTask` is constructed with `id: \`item-${index}\`` (line 122 in `musicDownloadFlow.ts`). This makes duplicate detection impossible — the same URL imported twice gets a different ID each time.

**Target:** Use a stable identifier derived from the URL itself:

```typescript
import { createHash } from 'crypto';

function taskIdFromUrl(url: string): string {
  return 'task:' + createHash('sha1').update(url).digest('hex').slice(0, 12);
}
```

Update `MusicDownloadFlow.importTasks()` (and the new clipboard import path in T3.5) to use `taskIdFromUrl(url)` instead of the positional index. Since `createHash` is Node built-in, no new dependency is needed.

This is a prerequisite for T3.4 (duplicate skipping) — the ID must be stable across re-imports for the collision check to work.

*Depends on: nothing*

---

### T3.2 — Clipboard read utility

Ink has no native clipboard API. Create `src/utils/clipboard.ts` with a single export:

```typescript
export async function readClipboard(): Promise<string>
```

Implementation using `child_process` with platform detection (no extra dependency):

```typescript
import { execSync } from 'child_process';

export async function readClipboard(): Promise<string> {
  switch (process.platform) {
    case 'win32':
      return execSync('powershell -command "Get-Clipboard"').toString().trim();
    case 'darwin':
      return execSync('pbpaste').toString();
    default:
      return execSync('xclip -selection clipboard -o').toString();
  }
}
```

If the command fails (e.g., `xclip` not installed), catch and return `''` — the URL detector will produce an empty list, which the caller handles gracefully.

*Depends on: nothing*

---

### T3.3 — URL detection and platform parsing utility

Create `src/utils/detectUrls.ts`. Given a string of arbitrary text (clipboard contents), extract all URLs that match a supported platform and identify each one:

```typescript
export type SupportedPlatform =
  | 'spotify' | 'youtube' | 'youtubeMusic'
  | 'soundcloud' | 'deezer' | 'appleMusic' | 'tidal';

export type DetectedUrl = {
  raw: string;       // the original URL as pasted
  platform: SupportedPlatform;
  type: 'track' | 'album' | 'playlist' | 'unknown';
};

export function detectUrls(text: string): DetectedUrl[]
```

Matching rules (expand as more platforms are enabled):

| Platform | URL pattern |
|----------|------------|
| `spotify` | `open.spotify.com/track/` → `type: 'track'`, `open.spotify.com/album/` → `'album'` |
| `youtube` | `youtube.com/watch` or `youtu.be/` → `'track'` |
| `youtubeMusic` | `music.youtube.com/watch` → `'track'` |
| `soundcloud` | `soundcloud.com/` (not homepage) → `'track'` |
| `deezer` | `deezer.com/track/` → `'track'` |
| `appleMusic` | `music.apple.com/` → `'track'` |
| `tidal` | `tidal.com/track/` → `'track'` |

Use a single URL extraction regex (`/https?:\/\/[^\s"'<>]+/gi`) to pull all URLs from the text first, then classify each. Unknown URLs (not matching any pattern) are excluded from the result.

*Depends on: nothing*

---

### T3.4 — Import state management and duplicate filtering

**Import state** needs to live somewhere accessible to both the `Ctrl+V` handler and the modal. Add it to `App.tsx` as local state (not `FocusState` — it is transient UI state, not navigation state):

```typescript
type PendingImport = {
  urls: DetectedUrl[];
  fetchMetadata: boolean;   // checkbox state — default: true
  download: boolean;        // checkbox state — default: false
} | null;

const [pendingImport, setPendingImport] = useState<PendingImport>(null);
```

Pass `pendingImport` and `setPendingImport` to the `<ImportModal>` component (T3.5).

**Duplicate filtering** in `MusicDownloadFlow`: before calling `orchestrator.addTasks()`, check the existing task list for URL collisions. Since task IDs are now URL-derived (T3.1), the check is simply:

```typescript
const existingIds = new Set(this.orchestrator.getTasks().map(t => t.getId()));
const newTasks = tasks.filter(t => !existingIds.has(t.getId()));
const skippedCount = tasks.length - newTasks.length;

if (skippedCount > 0) {
  this.logger.info(`Skipped ${skippedCount} URL(s) already in queue`);
}
if (newTasks.length > 0) {
  this.orchestrator.addTasks(newTasks);
}
```

Move this logic into a new `MusicDownloadFlow.addUrlsAsTask(urls: string[], opts: { toTag: boolean; toDownload: boolean })` method that both the old `importTasks()` path and the new clipboard path call. This avoids duplicating the task construction code.

*Depends on: T3.1, T3.3*

---

### T3.5 — ImportModal component

Create `src/components/ImportModal.tsx`. It renders as a centered overlay (same approach as `PromptModal`) when `pendingImport !== null`.

**Layout:**

```
╭─── Import 3 tracks ────────────────────────────────╮
│                                                      │
│  open.spotify.com/track/4uLU6hM…  [SPOTIFY]  track  │
│  music.youtube.com/watch?v=dQw4…  [YT MUSIC] track  │
│  youtube.com/watch?v=oHg5SJYRHA  [YOUTUBE]  track   │
│                                                      │
│  [✓] Fetch Metadata?   [ ] Download?                 │
│                                                      │
│  [ENTER] Confirm · [TAB] Toggle checkbox · [ESC] Cancel │
╰──────────────────────────────────────────────────────╯
```

**Props:**

```typescript
interface ImportModalProps {
  pendingImport: PendingImport;
  onConfirm: (opts: { fetchMetadata: boolean; download: boolean }) => void;
  onCancel: () => void;
}
```

**Keyboard handling** (handled by the centralized dispatcher via the `'importModal'` focus window from P1/T1.2; until P1 is done, use a local `useInput`):

- `Tab` → cycle checkbox focus between "Fetch Metadata?" and "Download?"
- `Space` → toggle the focused checkbox
- `Enter` → call `onConfirm({ fetchMetadata, download })`
- `Esc` → call `onCancel()`

The modal uses `useFocusContext()` to check `focusState.activeWindow === 'importModal'` — it renders but is inactive when another modal is on top. When it mounts, call `focusManager.switchWindow('importModal')`. When it unmounts or `onCancel()` is called, call `focusManager.switchBack()`.

URL lines: truncate long URLs to fit the modal width. Display platform badge as a colored label (reuse `SERVICE_DISPLAY_MAPPING` acronym/color from `musicDownloadFlow.ts` where available, fall back to the platform key uppercased). If the terminal supports OSC 8 hyperlinks (detectable via `process.env.TERM_PROGRAM`), wrap URLs in the escape sequence so they are clickable — otherwise render as plain text.

*Depends on: T3.3, T3.4, P1/T1.2*

---

### T3.6 — Wire `Ctrl+V` as a global import shortcut

Add `Ctrl+V` handling to the global key dispatcher (P1/T1.3). Until P1 is done, add it to `App.tsx`'s existing `useInput`:

```typescript
if (key.ctrl && input === 'v') {
  // Do not open a second import modal if one is already pending
  if (pendingImport !== null) return;
  // Do not interrupt a task prompt
  if (focusState.activeWindow === 'prompt') return;

  readClipboard()
    .then(text => {
      const urls = detectUrls(text);
      if (urls.length === 0) {
        globalLogger.info('Ctrl+V: no supported URLs found in clipboard');
        return;
      }
      setPendingImport({ urls, fetchMetadata: true, download: false });
      focusManager.switchWindow('importModal');
    })
    .catch(err => globalLogger.error('Clipboard read failed', { err }));
}
```

The `onConfirm` callback passed to `<ImportModal>`:

```typescript
const handleImportConfirm = ({ fetchMetadata, download }) => {
  const urls = pendingImport!.urls.map(d => d.raw);
  currentFlow.addUrlsAsTask(urls, { toTag: fetchMetadata, toDownload: download });
  setPendingImport(null);
  focusManager.switchBack();
};
```

*Depends on: T3.2, T3.3, T3.4, T3.5*

---

### T3.7 — Redirect the Import toolbar button to the clipboard flow

`useImportButton` currently calls `flow.importTasks()` on `Enter`. After this change, pressing the Import toolbar button should trigger the same clipboard-driven flow as `Ctrl+V`.

Move the clipboard read + modal open logic into a shared function (e.g., `openImportFlow()`) defined in `App.tsx` and passed to both the `Ctrl+V` handler and `useImportButton`. Update `useImportButton` to accept and call this function instead of `flow.importTasks()`.

`useImportButton` also currently registers its own `useInput` hook — remove it as part of P1/T1.6 (toolbar key migration). For now, the `isSelected + Enter` pattern can stay as-is.

*Depends on: T3.6*

---

### T3.8 — Remove the `inputs.txt` import mechanism

After T3.7 is complete and the clipboard flow is the only import path:

- Delete `MusicDownloadFlow.importTasks()` (the `fs.readFile('inputs.txt')` implementation)
- Rename `addUrlsAsTask()` (introduced in T3.4) to `importTasks()` to preserve the `FlowBase` interface, or update `FlowBase.importTasks()` signature to accept `(urls: string[], opts)`.
- Remove `inputs.txt` from the repo root (add to `.gitignore` if keeping it as a local dev tool)
- Remove the `InputLoader` import and `static inputLoader` field from `MusicDownloadFlow` if they are only used by the old `importTasks()` path

*Depends on: T3.7*

---

## Summary

| Task | What | Depends on |
|------|------|-----------|
| T3.1 | URL-based task IDs (replace `item-0`, `item-1`) | — |
| T3.2 | `readClipboard()` utility | — |
| T3.3 | `detectUrls()` utility with platform classification | — |
| T3.4 | Import state in `App.tsx` + duplicate filtering in flow | T3.1, T3.3 |
| T3.5 | `ImportModal` component with checkboxes | T3.3, T3.4, P1/T1.2 |
| T3.6 | `Ctrl+V` global shortcut wiring | T3.2, T3.3, T3.4, T3.5 |
| T3.7 | Redirect Import toolbar button to clipboard flow | T3.6 |
| T3.8 | Remove `inputs.txt` mechanism | T3.7 |
