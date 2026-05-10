# P7 — Settings System: Tasks

## Context

**What the settings modal looks like (from the design screenshot):**

A full-screen overlay opened with the Settings toolbar button and closed with `[Ctrl+S]`.  
Navigation: `↑/↓` moves the `☛` cursor, `[Enter]` or `[Space]` interacts with the selected item.  
Bottom action bar: `Selection >>> [Enter] Interact` · `Window > [Ctrl+S] Save & Exit`.

The list is a flat scrollable sequence of items grouped under section headers:

```
SETTINGS

General
  ☛ ☑ Re-open last session on start-up

Metadata
  □ Automatically fetch primary metadata on import
  □ Choose the best metadata automatically
  Columns
    ☑ Url    ☑ Artist    ☑ Track title
  2 providers
    ┌ Spotify ──────────────────────────────┐
    │  ☑ Enable                             │
    └───────────────────────────────────────┘
    ┌ Deezer ───────────────────────────────┐
    │  ☑ Enable                             │
    └───────────────────────────────────────┘
    ... Apple Music, Tidal, Youtube, Soundcloud ...
    ┌ MusicBrainz ──────────────────────────┐
    │  ☑ Enable                             │
    │  ☑ Import file in Picard on save      │
    │  ☑ Include MB metadata in tags        │
    │  ☑ Use MB links during discovering    │
    └───────────────────────────────────────┘

Download
  □ Choose the best download source automatically
  ☑ Auto-save to the specified output directory
  ☑ Automatically delete temporary downloads after 24h
  ☑ Auto-relocate missing files
  ☛ Set the default output directory: [T:\Music\Library\]
     Clear the download cache >
  Columns
    ☑ Url    ☑ Artist    ☑ Track title
  2 providers
    ┌ YtDlp ────────────────────────────────┐
    │  ☑ Enable                             │
    │  ☑ Auto-download latest binary        │
    └───────────────────────────────────────┘
    ┌ Soulseek ─────────────────────────────┐
    │  ☑ Enable                             │
    │  ☑ Auto-download latest binaries      │
    └───────────────────────────────────────┘
```

**Current state (as of P7 implementation):**

T7.1–T7.9 are ✅ complete. T7.10 (auto-behavior hooks) is deferred.

The `AppSettings` schema diverged from the plan: it covers only the `general` section (global, app-wide). Provider and flow-specific settings live in `MusicDownloadFlowSettings`, stored in the same JSON file under a `flows["music-downloader"]` namespace. This two-tier split keeps global settings separate from flow-specific ones and scales to future flows.

`SettingsStore` is a singleton with atomic writes (write-then-rename). The modal has a search bar (focused by default) and live `filterSettingsItems()` filtering.

Provider settings are auto-generated from `ProviderSettingsSchema` — each service class declares `static defaultSettings` and the modal renders it without any hardcoding. Provider enable/disable is rendered in the UI but does not yet rebuild service registries at runtime (the `enabled` flag is stored but not acted upon).

---

## Tasks

### T7.1 — Define the `AppSettings` schema ✅

**Implemented in `src/settings/appSettings.ts`.** Schema diverged from the plan: `AppSettings` covers only the `general` section (`reopenLastSession`, `appDataDir`, `animationsEnabled`). Metadata and download provider settings are in `MusicDownloadFlowSettings` (`src/flows/musicDownloadFlow/settings.ts`), stored under a `flows` namespace in the same JSON file. `DEFAULT_APP_SETTINGS` is the canonical source for app-level defaults.

Additionally, `src/base/providerSettings.ts` introduces `ProviderSettingsSchema` — a typed descriptor that provider classes declare as `static defaultSettings` to enable auto-generated settings UI, without any per-provider hardcoding in the modal.

Create `src/settings/appSettings.ts` with the canonical settings type. Every setting key lives here — this type drives both the persistence layer and the modal renderer.

```typescript
export type MetadataProviderKey =
  | 'spotify' | 'deezer' | 'appleMusic' | 'tidal'
  | 'youtube' | 'soundcloud' | 'musicBrainz';

export type DownloadProviderKey = 'ytdlp' | 'soulseek';

export type AppSettings = {

  // ── General ───────────────────────────────────────────────────
  general: {
    reopenLastSession: boolean;
  };

  // ── Metadata ──────────────────────────────────────────────────
  metadata: {
    autoFetchOnImport: boolean;
    autoChooseBestSource: boolean;
    visibleColumns: {
      url: boolean;
      artist: boolean;
      trackTitle: boolean;
    };
    providers: {
      [K in MetadataProviderKey]: {
        enabled: boolean;
      };
    } & {
      musicBrainz: {
        enabled: boolean;
        importInPicardOnSave: boolean;
        includeTagsByDefault: boolean;
        useLinksForDiscovering: boolean;
      };
    };
  };

  // ── Download ──────────────────────────────────────────────────
  download: {
    autoChooseBestSource: boolean;
    autoSaveToOutputDir: boolean;
    autoDeleteTempAfter24h: boolean;
    autoRelocateMissingFiles: boolean;
    outputDir: string;
    visibleColumns: {
      url: boolean;
      artist: boolean;
      trackTitle: boolean;
    };
    providers: {
      ytdlp: {
        enabled: boolean;
        autoDownloadBinary: boolean;
      };
      soulseek: {
        enabled: boolean;
        autoDownloadBinary: boolean;
      };
    };
  };
};
```

Also export `DEFAULT_SETTINGS: AppSettings` with every field filled in (all providers enabled, `outputDir: path.join(os.homedir(), 'Music')`, reasonable auto-behavior defaults).

*Depends on: nothing*

---

### T7.2 — Settings persistence: read, write, and in-memory cache ✅

**Implemented in `src/settings/settingsStore.ts` as a `SettingsStore` singleton class.** The on-disk format is `{ general: AppSettings['general'], flows: Record<string, unknown> }`. App settings and per-flow settings share one file. Atomic write (write `.tmp`, then `fs.renameSync()`). API:

- `getAppSettings()` / `writeAppSettings()` — global settings
- `getFlowSettings<T>(flowId, defaults)` / `writeFlowSettings(flowId, settings)` — per-flow settings
- `onSettingsChanged(cb)` — returns an unsubscribe function; emitted after every write

`DeepPartial<T>` and `deepMerge<T>()` live in `src/utils/types.ts` and `src/utils/deepMerge.ts`. `FlowSettings<T>` (`src/base/flow/flow-settings.ts`) is a thin typed wrapper around `SettingsStore` used by `MusicDownloadFlow`.

Create `src/settings/settingsStore.ts`.

**Storage path:** `path.join(PROJECT_ROOT, 'config', 'settings.json')`. Create `config/` on first write. Add `config/settings.json` to `.gitignore`.

```typescript
export function readSettings(): AppSettings
export function writeSettings(settings: AppSettings): void
export function getSettings(): AppSettings          // cached; call this at runtime
export function updateSettings(patch: DeepPartial<AppSettings>): void
```

**`readSettings()`** — reads the JSON file from disk. Deep-merges the result with `DEFAULT_SETTINGS` so any missing keys from older file versions get their defaults. Returns `DEFAULT_SETTINGS` if the file doesn't exist.

**`writeSettings()`** — serializes to JSON with 2-space indent. Creates the `config/` directory if needed.

**`getSettings()`** — on first call, reads from disk and caches the result in a module-level variable. On subsequent calls, returns the cached value. The cache is invalidated (re-read from disk) only when `writeSettings()` is called within the same process.

**`updateSettings(patch)`** — deep-merges `patch` into the cached settings, then calls `writeSettings()`. Components call this on `[Ctrl+S]` with the final modal state.

`DeepPartial<T>` — a recursive `Partial` utility type; define it in `src/utils/types.ts`.

*Depends on: T7.1*

---

### T7.3 — Define the flat settings item model ✅

**Implemented across three files:**

- `src/settings/buildSettingsItems.ts` — `SettingsItem` discriminated union (with `indent: number` on interactive items); `isInteractive()`, `itemRowHeight()` (headers take 2 visual rows), `filterSettingsItems()` (search filter that preserves ancestor headers for matching items)
- `src/settings/buildGlobalSettingsItems.ts` — builds the global/app settings item list (General section)
- `src/flows/musicDownloadFlow/buildFlowSettingsItems.ts` — builds flow-specific items; reads `ProviderSettingsSchema` from each registered provider constructor to auto-render provider cards. `buildFlowSettingsItems()` is called by `MusicDownloadFlow.buildFlowSettingsItems()`, which `SettingsModal` invokes on the active flow.

The settings modal renders a flat scrollable list of items. Rather than building the list structure inside the component, define it as a typed data structure that the component consumes:

```typescript
export type SettingsItem =
  | { kind: 'sectionHeader'; label: string }
  | { kind: 'subHeader';     label: string }
  | { kind: 'providerHeader'; label: string; color: string }
  | { kind: 'checkbox';  label: string; get: () => boolean; set: (v: boolean) => void }
  | { kind: 'textInput'; label: string; get: () => string;  set: (v: string) => void }
  | { kind: 'action';    label: string; run: () => void };
```

Create `src/settings/buildSettingsItems.ts`:

```typescript
export function buildSettingsItems(
  settings: AppSettings,
  onChange: (patch: DeepPartial<AppSettings>) => void,
): SettingsItem[]
```

This returns the full ordered list matching the screenshot layout. Every `checkbox.set` and `textInput.set` calls `onChange(patch)` with the minimal patch that updates that key. The component never touches `AppSettings` directly — it only calls item methods.

Separating the list-builder from the renderer means the item list can be unit-tested without rendering.

*Depends on: T7.1*

---

### T7.4 — Build `SettingsModal` component ✅

**Implemented in `src/components/SettingsModal.tsx`.** Key differences from the plan:

- Opened when `focusState.activeWindow === 'settingsModal'`; returns `null` when inactive (always mounted)
- Has two focus modes: `'search'` (default on open) and `'list'`; `↓/Enter` from the search bar moves to the list, `↑` from the top of the list returns to the search bar
- `appDraft` holds pending app settings; `flowPatch` holds pending flow settings changes — both are deep-merged and written together on `Ctrl+S`
- Flow settings items come from `currentFlow.buildFlowSettingsItems()` (a method on `FlowBase`) so the modal is flow-agnostic
- Height-aware scroll: `itemRowHeight()` accounts for headers occupying 2 visual rows; scroll offset keeps the selected item centered
- Mounted in `src/components/AppInner.tsx` alongside `<PromptModal>` and `<ImportModal>`

Create `src/components/SettingsModal.tsx`. It renders as a full-screen overlay when `focusState.activeWindow === 'settingsModal'` (added to `FocusableWindow` in P1/T1.2).

**Structure:**

```
╭─── SETTINGS ────────────────────────────────────────╮
│                                                      │
│  [scrollable item list]                              │
│                                                      │
│  Selection >>> [Enter] Interact                      │
│  Window >  [Ctrl+S] Save & Exit                      │
╰──────────────────────────────────────────────────────╯
```

**State:**

```typescript
const [draft, setDraft] = useState<AppSettings>(() => getSettings());
const [selectedIndex, setSelectedIndex] = useState(0);
const [editingIndex, setEditingIndex] = useState<number | null>(null);
```

`draft` holds the in-progress settings — changes are applied to `draft` immediately for live preview, but written to disk only when `[Ctrl+S]` is pressed (`writeSettings(draft)`).

The item list is derived via `useMemo(() => buildSettingsItems(draft, patch => setDraft(prev => deepMerge(prev, patch))), [draft])`.

On mount, call `focusManager.switchWindow('settingsModal')`. On unmount (or `[Ctrl+S]`), call `focusManager.switchBack()`.

*Depends on: T7.2, T7.3, P1/T1.2*

---

### T7.5 — Build per-item-type renderers ✅

**Implemented in `src/components/SettingsItemRow.tsx`** (named `SettingsItemRow`, not `SettingsItemRow` from `SettingsItem.tsx` as originally planned). Accepts `editValue`/`onEditChange`/`onEditSubmit` props so the parent (`SettingsModal`) owns editing state. `TextInput` edit mode is triggered by `Enter` on a `textInput` item; `Esc` cancels without calling `item.set()`.

Each `SettingsItem.kind` renders differently. Create `src/components/SettingsItem.tsx`:

```typescript
export const SettingsItemRow: React.FC<{
  item: SettingsItem;
  isSelected: boolean;
  isEditing: boolean;
  width: number;
}> = ...
```

| Kind | Appearance |
|------|-----------|
| `sectionHeader` | Bold label, no cursor |
| `subHeader` | Indented label, dim, no cursor |
| `providerHeader` | Colored background label (uses `SERVICE_DISPLAY_MAPPING` color where applicable) |
| `checkbox` | `☑` / `□` + label; cursor shown when selected |
| `textInput` | `label: [current value]`; when `isEditing`, renders `<TextInput>` from `ink-text-input` pre-filled with current value |
| `action` | `label >`; cursor shown when selected |

Provider card items (checkboxes inside a provider) are indented by 2 spaces. The provider header row itself is rendered with a left border accent using the provider's color.

*Depends on: T7.3, T7.4*

---

### T7.6 — Keyboard handling in the settings modal ✅

**Implemented inside `SettingsModal.tsx`** via two `useInput` hooks (one global, one list-only). Navigation:

- Search mode: `↓`/`Enter` → enter list; `Ctrl+S` save; `Esc` with query clears query, then discards
- List mode: `↑/↓` skip non-interactive items; `Enter` toggles checkbox / enters edit mode / runs action; `↑` from index 0 returns to search
- Edit mode: `Enter` submits, `Esc` cancels (no `item.set()` called)

`Space` to toggle checkboxes is not implemented (only `Enter` toggles).

Register a `'settingsModal'` key handler via the centralized dispatcher (P1/T1.4). Until P1 is done, use a local `useInput({ isActive: focusState.activeWindow === 'settingsModal' })` inside `SettingsModal`.

**Navigation and interaction:**

```
↑ / ↓        Move cursor (skip non-interactive items: sectionHeader, subHeader, providerHeader)
Space        Toggle checkbox under cursor
Enter        Toggle checkbox — or — activate textInput (enter edit mode) — or — run action
Ctrl+S       writeSettings(draft); focusManager.switchBack()
Esc          Discard draft (restore getSettings()); focusManager.switchBack()
```

**Text input edit mode** (`editingIndex !== null`):

- `↑/↓` are captured by `<TextInput>` (line navigation within the input); do NOT move the cursor
- `Enter` submits: calls `item.set(newValue)`, clears `editingIndex`
- `Esc` cancels: clears `editingIndex` without calling `item.set()`

**Action items** — `[Enter]` on a `'action'` item calls `item.run()`. If the action is destructive (e.g. "Clear download cache"), show a `TaskPrompt` confirmation first.

*Depends on: T7.4, P1/T1.4*

---

### T7.7 — Wire the Settings toolbar button to open the modal ✅

**Implemented in `src/flows/musicDownloadFlow/toolbar/useSettingsButton.ts`.** Uses `onPress: () => switchWindow('settingsModal')` — simpler than the planned `useInput` approach since the toolbar button hook already receives an `onPress` callback.

The existing Settings button in `MusicDownloadFlow.getToolbarButtons()` (line 167–172 of `musicDownloadFlow.ts`) returns a label with no handler. Replace it with a real `useSettingsButton` hook:

```typescript
// src/flows/musicDownloadFlow/toolbar/useSettingsButton.ts
export const useSettingsButton: ToolbarButtonHook = ({ isSelected, flow, orchestrator }) => {
  const { focusManager } = useFocusContext();

  useInput((input, key) => {
    if (key.return) {
      focusManager.switchWindow('settingsModal');
    }
  }, { isActive: isSelected });

  return { label: 'Settings', icon: '⛭', color: 'gray', enabled: true };
};
```

After P1/T1.6 (toolbar key migration), the `useInput` inside this hook moves to the toolbar key handler.

Render `<SettingsModal>` in `App.tsx` alongside `<PromptModal>` and `<ImportModal>` — it is always mounted but only visible/active when `focusState.activeWindow === 'settingsModal'`.

*Depends on: T7.4, T7.6*

---

### T7.8 — Make service registries dynamic from settings ⚠️ Partial

**`onSettingsChanged` is wired** — `MusicDownloadFlow` subscribes and calls `notifyTaskSubscribers()` so the UI re-renders when settings change. `MusicDownloadFlow.buildFlowSettingsItems()` exposes registered providers to the modal so provider settings cards are auto-generated.

**Registry rebuild is not implemented.** Providers are still registered unconditionally in the constructor. The `enabled` field in each provider's stored settings is rendered as a checkbox but has no effect at runtime — the registry is never torn down and rebuilt. This was deprioritized because enabling/disabling providers at runtime requires active tasks to be re-evaluated, which overlaps with P9 (session management).

Currently `MusicDownloadFlow`'s constructor hardcodes which services are registered. After P7, registries are built from `getSettings()`:

```typescript
private buildMetadataRegistry(): ServiceRegistry<DownloadTask, MetadataService> {
  const { providers } = getSettings().metadata;
  const registry = new ServiceRegistry<DownloadTask, MetadataService>();

  if (providers.spotify.enabled)
    registry.register('spotify', (t, l) => new SpotifyService(t, l));
  if (providers.youtube.enabled)
    registry.register('youtube', (t, l) => new YoutubeService(t, l));
  if (providers.musicBrainz.enabled)
    registry.register('musicbrainz', (t, l) => new MusicBrainzService(t, l));
  // ... deezer, appleMusic, tidal, soundcloud when services are implemented
  return registry;
}
```

Do the same for `buildDownloadRegistry()`.

Call `buildMetadataRegistry()` and `buildDownloadRegistry()` in the constructor (replacing the inline `.register()` chains). Also call them when settings change — subscribe to a settings-change event emitted by `writeSettings()` (or expose a `MusicDownloadFlow.reloadSettings()` method called from the `[Ctrl+S]` save handler in the modal).

When registries change, `getColumns()` automatically reflects the new set of providers (it already iterates `metadataServiceRegistry.getFactories()`). No column update logic needed.

*Depends on: T7.2, T7.7*

---

### T7.9 — Connect P6's `getSaveSettings()` stub to real settings ✅

**Implemented.** `getSaveSettings()` in `src/flows/musicDownloadFlow/saveSettings.ts` now calls `SettingsStore.getInstance().getFlowSettings('music-downloader', BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS)` to get the live `outputDir`. `includeMusicBrainzTags` returns `false` for now (MusicBrainz not yet enabled — see P9). `getDownloadDir()` is also exported from this file.

P6/T6.4 created:

```typescript
export function getSaveSettings(): SaveSettings {
  return getDefaultSaveSettings();  // stub
}
```

Replace the stub body:

```typescript
import { getSettings } from '../../settings/settingsStore';

export function getSaveSettings(): SaveSettings {
  const s = getSettings();
  return {
    outputDir: s.download.outputDir,
    includeMusicBrainzTags: s.metadata.providers.musicBrainz.includeTagsByDefault,
  };
}
```

Delete `getDefaultSaveSettings()` — it is no longer needed. `DEFAULT_SETTINGS` in `appSettings.ts` is the canonical source of defaults.

*Depends on: T7.2, P6/T6.4*

---

### T7.10 — Implement auto-behavior hooks ❌ Deferred

Not implemented. The settings flags (`autoFetchOnImport`, `autoSaveToOutputDir`, `autoDeleteTempAfter24h`, `autoRelocateMissingFiles`, `autoChooseBestSource`) are stored and rendered in the modal but are not yet read by any code path. Implementation depends on P6/T6.5 and P3/T3.4, which themselves have open work.

Connect the boolean settings flags to actual behaviors. Each is a conditional call in an existing code path:

| Setting | Where to add the check | Behavior when `true` |
|---------|----------------------|----------------------|
| `metadata.autoFetchOnImport` | `MusicDownloadFlow.addUrlsAsTask()` (P3/T3.4), after creating tasks | Call `orchestrator.processTask(task)` for each new task immediately |
| `download.autoSaveToOutputDir` | `DownloadTask.startDownloads()`, after downloads complete | Call `task.saveTrack()` automatically |
| `download.autoDeleteTempAfter24h` | App startup or a background interval | Walk `DOWNLOAD_DIR`, delete files older than 24h that are not referenced by any active `localFile.path` |
| `download.autoRelocateMissingFiles` | App startup (before rendering) | For each `downloadSource` with `localFile.state === 'not_found'`, attempt to find a file with the same name in `outputDir` and update the path |
| `metadata.autoChooseBestSource` | `DownloadTask.startMetadataDiscovering()`, after all sources are fetched | Auto-sort `metadataSources` by a quality heuristic (primary source first, then prefer sources with more fields populated) |
| `download.autoChooseBestSource` | `DownloadTask.startDownloads()`, after all downloads complete | Auto-select the highest-quality source (prefer FLAC > MP3, larger file size) |

`autoDeleteTempAfter24h` is the most complex: a `setInterval` at app startup that runs hourly, walks `DOWNLOAD_DIR`, and deletes any file whose `mtime` is older than 24h AND is not found in any task's `localFile.path`. Needs access to the orchestrator's task list.

*Depends on: T7.2, T7.8, P3/T3.4, P6/T6.5*

---

## Summary

| Task | Status | What | Notes |
|------|--------|------|-------|
| T7.1 | ✅ | `AppSettings` (general only) + `DEFAULT_APP_SETTINGS`; `MusicDownloadFlowSettings` for flow settings; `ProviderSettingsSchema` for per-provider UI | Schema split into app vs. flow tiers |
| T7.2 | ✅ | `SettingsStore` singleton: `getAppSettings`, `writeAppSettings`, `getFlowSettings`, `writeFlowSettings`, `onSettingsChanged`; atomic writes | Singleton class, not free functions |
| T7.3 | ✅ | `SettingsItem` types + `isInteractive`, `itemRowHeight`, `filterSettingsItems`; `buildGlobalSettingsItems`; `buildFlowSettingsItems` (provider-driven) | Split across 3 files; search filtering added |
| T7.4 | ✅ | `SettingsModal` with search bar, dual focus modes, height-aware scroll, app+flow draft state | Search bar focused by default; flow-agnostic via `FlowBase` interface |
| T7.5 | ✅ | `SettingsItemRow` per-kind renderer | File named `SettingsItemRow.tsx` |
| T7.6 | ✅ | Keyboard: `↑/↓`, `Enter`, `Ctrl+S`, `Esc`; two `useInput` hooks inside `SettingsModal` | `Space` not wired; two focus modes (search/list) |
| T7.7 | ✅ | `useSettingsButton` opens modal via `onPress` | Uses `switchWindow('settingsModal')` |
| T7.8 | ⚠️ | `onSettingsChanged` triggers UI refresh; `buildFlowSettingsItems` auto-generates provider cards | Registry rebuild from `enabled` flag not implemented |
| T7.9 | ✅ | `getSaveSettings()` reads live `outputDir` from `SettingsStore` | `includeMusicBrainzTags` hardcoded `false` pending P9 |
| T7.10 | ❌ | Auto-behavior hooks (auto-fetch, auto-save, auto-delete, auto-relocate) | Deferred; depends on P6/T6.5, P3/T3.4 |
