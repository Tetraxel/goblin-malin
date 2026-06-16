# P13 — Session Management

## Context

Tasks live **only in memory** in the `FlowOrchestrator` singleton (`src/base/flow/flow-orchestrator.ts`).
When the app closes, the working set — imported URLs, fetched metadata, downloads — is lost. There is
no way to revisit a previous batch of work.

P13 adds a **session system**. A session *is* the list of tasks. Sessions are persisted to
`DEFAULT_APP_DATA_DIR` (next to `settings.json`, `cache/`, `bin/`), can be reopened on startup, and
are browsed through a new toolbar button + searchable modal.

The already-existing `general.reopenLastSession` setting (`src/settings/appSettings.ts`, surfaced in
`src/settings/buildGlobalSettingsItems.ts:38`) gates startup restoration — **no settings work is needed**.

**Product decisions (confirmed):**

- **Lifecycle = per app launch.** The live task list is mirrored into a "current session" and
  auto-saved (debounced). A launch that does *not* reopen begins a fresh **draft** session; the first
  imported task persists it. `reopenLastSession` continues the last session. Selecting an old session
  in the modal makes it current.
- **Modal actions** (beyond search / view / load / rename): **delete**, **new empty session**, **duplicate**.
- If there are no stored sessions and reopen is off, behavior is unchanged from today.

This respects the project's extensibility philosophy: persistence is generic over the existing
`TaskSnapshot`, and flow-specific reconstruction is a new **optional** `FlowBase` hook, so other flows
opt in without touching the session core.

---

## Architecture

### Serialization (already supported)

`Task.get()` returns `TaskSnapshot { id, initialInput, attributes, status, prompt }`
(`src/base/task/task.ts:15`). For the music flow, `attributes` is the fully JSON-able
`MusicDownloadTaskAttributes` (url, metadata groups, overrides, download sources). Three `Date` fields
must be revived on load (JSON turns them into strings): `metadata.fetchedAt`,
`downloadSources[].savedFile.savedAt`, `downloadSources[].localFile.downloadedAt`
(`src/flows/musicDownloadFlow/types.ts:131,279,287`).

### Data model & storage

One file: **`DEFAULT_APP_DATA_DIR/sessions.json`** (single file — consistent with `settings.json`,
simpler to load/search than a per-session directory).

```ts
// src/sessions/types.ts
type SessionTaskSnapshot = TaskSnapshot<MusicDownloadTaskAttributes>;

interface StoredSession {
    id: string;               // crypto.randomUUID()
    name: string;             // default derived from first track/url; user-editable
    flowId: string;           // "music-downloader"
    createdAt: string;        // ISO
    updatedAt: string;        // ISO
    tasks: SessionTaskSnapshot[];
}

interface SessionsFile {
    version: 1;
    lastSessionId: string | null;   // drives reopenLastSession
    sessions: StoredSession[];
}
```

`currentSessionId` is **runtime-only** (held by the SessionManager). It may be a **draft** (`null`)
until the first task is added; an empty draft is never written, so no empty sessions clutter history.
Each persist also sets `lastSessionId = currentSessionId`.

### `SessionStore` (`src/sessions/sessionStore.ts`)

Persistence singleton modeled on `SettingsStore` (`src/settings/settingsStore.ts`): atomic write
(`.tmp` + `fs.renameSync`), cached read with safe fallback `{ version:1, lastSessionId:null, sessions:[] }`,
`EventEmitter` "change". API: `getAll()`, `getById(id)`, `getLastSession()`, `upsertSession(s)`,
`deleteSession(id)`, `renameSession(id, name)`, `setLastSessionId(id)`, `onChanged(cb)`.

### `SessionManager` (`src/sessions/sessionManager.ts`)

Runtime bridge between orchestrator and store (singleton). Holds `currentSessionId`, exposes its own
`EventEmitter` for the modal. An internal `isLoading` flag prevents the reopen load from triggering a
redundant write.

- `init(flow, orchestrator)` — once at startup. If `reopenLastSession` and `getLastSession()` exists →
  `loadSession(last.id)`. Else stay a draft (`currentSessionId = null`).
- `loadSession(id)` — read snapshots → `flow.createTasksFromSnapshots(snapshots)` →
  `orchestrator.setTasks(tasks)` → set `currentSessionId` + `lastSessionId`.
- `persistCurrent(snapshots)` — **debounced (~800 ms)**. Empty + draft → no-op. Draft → create
  `StoredSession` (uuid + derived name), upsert, set `currentSessionId`. Else update current session's
  `tasks` + `updatedAt`. Always refresh `lastSessionId`.
- `newSession()` — `orchestrator.setTasks([])`, `currentSessionId = null`.
- `duplicateSession(id)` — clone tasks into a new `StoredSession` ("Copy of …"), upsert, then
  `loadSession(newId)` so it becomes current.
- `deleteSession(id)` — `store.deleteSession`; if it was current, `newSession()`.
- `getCurrentSessionId()`, `onChanged(cb)`.

### Reconstruction & search (`src/flows/musicDownloadFlow/`, `src/sessions/sessionSearch.ts`)

- `MusicDownloadFlow.createTasksFromSnapshots(snapshots)` — mirrors `createTasksFromUrls`
  (`musicDownloadFlow.ts:181`) but preserves each snapshot's `id`, `initialInput`, and
  **date-revived** `attributes`, wiring the same registries + `isXEnabled` callbacks. A new
  `reviveTaskDates(attributes)` util converts the three known `Date` strings back to `Date`.
- `sessionMatchesQuery(session, q)` — lowercased `includes` over: session name, each task's url
  (`attributes.userInput.url` / `initialInput`), each `metadataGroups[].results[].metadata.trackName`
  and `artists[].name`, and `metadataOverride.trackName/artists`.
- `deriveSessionName(snapshots)` — "Artist – Track" of the first task's primary result, else first
  URL, else `"Session <date>"`.

### UI — toolbar button + modal

- `src/components/Toolbar/useSessionsButton.ts` — mirrors `useSettingsButton.ts`; `onPress: () =>
  switchWindow("sessionsModal")`. Inserted **before** `useSettingsButton` in the toolbar array
  (`src/components/App.tsx:76`).
- `src/components/SessionsModal/SessionsModal.tsx` — modeled on `SettingsModal.tsx`: absolute overlay,
  `useShortcuts({ id:"sessionsModal", isActive, exclusive:true, priority:300 })`, `ink-text-input`
  search **focused by default**, list with `☛` cursor + height-aware scroll. A `useSessions()` hook
  subscribes to `sessionStore.onChanged` + `sessionManager.onChanged`, sorts so the **current session
  is pinned first** (rest by `updatedAt` desc), and applies `sessionMatchesQuery`. Rows show name,
  date, task count, short track preview; the current session is badged (`● CURRENT`,
  `theme.action.primary`) distinct from the selection cursor.
- Keys: search → `↓/Enter` to list; list `↑↓` navigate (`↑` at top → search); **Enter** = load & close;
  **r** = rename (inline `TextInput`, Enter commits → `store.renameSession`, Esc cancels);
  **n** = new empty session (+close); **c** = duplicate; **Delete/x** = delete (small confirm like
  `SettingsModal`'s `confirmExit`); **Esc** clears search else closes (`switchBack`).

### Startup & auto-save wiring (`src/components/App.tsx`)

- One-shot effect once `currentFlow` is ready: `SessionManager.getInstance().init(currentFlow, orchestrator)`.
- In the existing `orchestrator.subscribe` effect (`App.tsx:84`): also call
  `SessionManager.getInstance().persistCurrent(currentFlowTasks.map(t => t.get()))` (debounced inside
  the manager).

---

## Files

| File | Change |
| ---- | ------ |
| `src/sessions/types.ts` | New — `StoredSession`, `SessionsFile`, `SessionTaskSnapshot` |
| `src/sessions/sessionStore.ts` | New — persistence singleton (atomic write, cache, EventEmitter) |
| `src/sessions/sessionManager.ts` | New — runtime bridge: current-session lifecycle, load/persist/new/duplicate/delete |
| `src/sessions/sessionSearch.ts` | New — `sessionMatchesQuery`, `deriveSessionName` |
| `src/components/Toolbar/useSessionsButton.ts` | New — toolbar button opening the modal |
| `src/components/SessionsModal/SessionsModal.tsx` | New — searchable sessions modal |
| `src/components/SessionsModal/useSessions.ts` | New — hook feeding the modal (store + manager subscriptions, sort, filter) |
| `src/flows/musicDownloadFlow/utils/reviveTaskDates.ts` | New — revive `Date` fields on load |
| `src/hooks/useFocusManager.ts` | Add `"sessionsModal"` to `FocusableWindow` |
| `src/components/App.tsx` | Insert `useSessionsButton` before `useSettingsButton`; wire `SessionManager.init` + debounced `persistCurrent` |
| `src/components/AppInner.tsx` | Render `<SessionsModal>` alongside the other modals |
| `src/base/flow/flow-orchestrator.ts` | Add `setTasks(tasks)` (replace + notify) |
| `src/base/flow/flow-base.ts` | Add optional `createTasksFromSnapshots?(snapshots)` hook signature |
| `src/flows/musicDownloadFlow/musicDownloadFlow.ts` | Implement `createTasksFromSnapshots` |

---

## Task List

| #   | Title                                                      | Files                                                        | Deps        | Status   |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------ | ----------- | -------- |
| T01 | Session types                                              | `sessions/types.ts`                                          | —           | ⬜ Todo |
| T02 | `SessionStore` persistence singleton                       | `sessions/sessionStore.ts`                                   | T01         | ⬜ Todo |
| T03 | `reviveTaskDates` + `createTasksFromSnapshots`             | `utils/reviveTaskDates.ts`, `flow-base.ts`, `musicDownloadFlow.ts` | T01   | ⬜ Todo |
| T04 | `orchestrator.setTasks(tasks)`                             | `flow-orchestrator.ts`                                       | —           | ⬜ Todo |
| T05 | `SessionManager` (load / persist / new / duplicate / delete)| `sessions/sessionManager.ts`                                | T02–T04     | ⬜ Todo |
| T06 | `sessionSearch` (match + derive name)                      | `sessions/sessionSearch.ts`                                  | T01         | ⬜ Todo |
| T07 | `"sessionsModal"` focus window + `useSessionsButton`       | `useFocusManager.ts`, `useSessionsButton.ts`, `App.tsx`      | —           | ⬜ Todo |
| T08 | `useSessions` hook                                         | `SessionsModal/useSessions.ts`                              | T02, T05, T06 | ⬜ Todo |
| T09 | `SessionsModal` component (search, list, actions)          | `SessionsModal/SessionsModal.tsx`, `AppInner.tsx`            | T07, T08    | ⬜ Todo |
| T10 | Startup reopen + debounced auto-save wiring               | `App.tsx`                                                    | T05         | ⬜ Todo |

---

## Architectural Notes & Risks

- **Empty draft never persisted** → "no stored sessions ⇒ nothing changes" holds; reopen-off launches
  create no junk entries.
- **Date revival is essential** — display cells type these fields as `Date`; skipping revival risks
  `.toLocaleString()`-style crashes on reopened tasks.
- **Status/prompt** are not reconstructed (the `Task` constructor takes no status). Restored
  `attributes` carry `state` + per-source states that drive most of the UI — acceptable for the POC.
- **Switching while downloads run**: detached promises from old `Task` objects resolve harmlessly. POC
  allows it; a guard/confirm can be added later.
- **Selection clamping**: after `setTasks`, `useFocusManager`'s existing range clamping handles a now
  out-of-range `selectedTaskIndex`; verify the list lands on a valid row.
- **Persist thrash**: download progress updates attributes frequently — the ~800 ms debounce in
  `persistCurrent` keeps disk writes bounded.

---

## Verification

1. `yarn run type-check` and `yarn run lint` clean (ignore the pre-existing TS errors).
2. `yarn run dev`: import URLs (Ctrl+V), let metadata fetch. Confirm
   `DEFAULT_APP_DATA_DIR/sessions.json` (dev: `<root>/data/sessions.json`) holds one session with the
   task snapshots + a `lastSessionId`.
3. Enable "Re-open last session on start-up", quit, relaunch → tasks reappear with metadata intact
   (artist/track render, no Date crash).
4. Open the **Sessions** button (left of ⛭ Settings). Search bar focused: type a track name, artist,
   and URL fragment → list filters on each. Current session pinned on top and badged.
5. Select another session + **Enter** → working set swaps. **r** renames inline (persists). **n** clears
   to a new empty session. **c** duplicates. **Delete** removes (confirm); deleting the current one
   empties the working set.
6. With reopen **off**, relaunch and import → a *new* session entry is created (per-launch lifecycle);
   the previous one remains in history.
