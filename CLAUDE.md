# Claude Code — Project Context

## Quick orientation

- **What this is:** A keyboard-driven terminal UI (Ink/React) for downloading and tagging music tracks from streaming platforms.
- **Current state:** Working pipeline, heading to v0.2.0 — Spotify / YouTube links, albums and playlists → cross-platform discovery → yt-dlp / Soulseek download → tagged audio file (FLAC by default, other formats or none via Settings → Download). See [README.md](README.md) for what a user gets and [TODO.md](TODO.md) for what is left.
    - Run the local script [scripts/TREE.ps1](scripts/TREE.ps1) to get the full project tree
- **Target state:** [docs/designs/](docs/designs/) (screenshots contain the most detail) and the "Promised … but not built yet" list in [TODO.md](TODO.md).

## Key documents

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Short architecture map: layers, the task pipeline, provider registries, data on disk. Read this before exploring the codebase.
- [docs/projects/README.md](docs/projects/README.md) — High-level technical projects (roadmap and history). Older projects may describe code that has since been removed; they say so at the top.

## Provider extensibility

> **Philosophy**: We don't want to hardcode metadata/download providers! They must be interchangeable and extensible. The app should be able to support any number of metadata and download providers without requiring changes to the core pipeline logic or UI components.

Adding a new provider should require changes in only two places:

1. A new service class file (the implementation)
2. One `.register(MyService)` call in `initMusicApp()` (`src/flows/musicDownloadFlow/init.ts`)

Optional static capabilities a service class can declare (all read generically — never branch on a provider key):

- `static consent: { title, message }` — the provider sends data to a third party or spends the user's quota, so it is **off until the user allows it, once** (a confirm dialog shown on first use; `utils/discoveryConsent.ts`). Its `enabled` default must be `false`. Used by Songlink and Claude.
- `static lastResort = true` (discovery services) — slow/costly; only runs when a platform is still missing after all regular discovery, and its results must pass the platform's own metadata fetch + a confidence check. Used by Claude.
- `static platformAliases = ["youtubeMusic"]` (metadata services) — other platform keys whose tracks the service handles; read through `platformRegistry.canonical()` (`src/base/platformRegistry.ts`). Never compare a platform to `"youtubeMusic"` in core code.
- `static trackUrl = (id) => url` (metadata services) — canonical URL of one of the service's tracks; read through `platformRegistry.trackUrl()`.
- `static openUri = (parsed) => uri | undefined` (metadata services) — the address that opens one of the service's links in its desktop app (`spotify:track:<id>`). A link a registered service reads takes its name, colors and app address from that service (`src/utils/appLinks.ts` asks `urlParserRegistry` first); the regex/site table there is only the fallback for sites no service reads.
- `static columnActions = (task) => ContextualActions[]` (any service) — extra actions for the service's column in the task list (MusicBrainz: review a match, add a missing release); read by `contextualActions.ts` through the registry, shown before the generic copy/open actions. Never branch on a provider key.
- `getAlbumDetails?(album, { withIsrcs })` (metadata services, instance method) — the whole album the track belongs to (barcode, track list, artist pages). A track's own `album` is usually the "simplified" one; the MusicBrainz checks ask the service that owns the album's link (`DownloadTask.fetchAlbumDetails`).

### User data is never rebuilt away

Whatever the user typed or pasted by hand must live **outside** anything the pipeline rebuilds. `metadataGroups`, `downloadSources` and the discovery results are rebuilt by restart, re-discovery and "stopped → start" — so a link the user added is stored in `TrackDownloadTask.userSources` (written _before_ anything is fetched, never cleared by any pipeline step; only the user's own **Delete** on the row, `DownloadTask.removeUserSource()`, removes an entry — **Reject** keeps it) and `DownloadTask.applyUserSources()` puts each entry back among the sources every time the groups are rebuilt. A link that cannot be read right now (network, a platform switched off) stays as a row to retry, never dropped. If you add a new kind of hand-entered data, give it the same treatment and a test that restarts the task (`tests/unit/userSources.test.ts`).

### Pasted text

Most terminals catch `Ctrl+V` and type the clipboard into the app as plain input, so a "Ctrl+V" shortcut alone never fires for a paste: `ShortcutDispatcher` sees a chunk of text with links in it and opens the import dialog. A part of the screen with its own use for a pasted link (e.g. "add it to this track") registers a handler with `pasteRouter.register()` (`src/base/pasteRouter.ts`) while it is focused and returns true to claim the text; the import dialog only opens when nobody does. Keep the `Ctrl+V` shortcut as well, for terminals that deliver the key.

### Asking the user from plain TypeScript

`dialogBridge.confirm({ title, message, choices })` and `dialogBridge.choose({ title, items, noneLabel })` (`src/base/bridges/dialogBridge.ts`) let a flow ask and `await` the answer; both resolve `null` when dismissed **or when no UI is mounted**, so "nobody answered" is never read as consent. When a list needs a lookup first (a network request), pass `body: Promise<{ items, intro?, noneLabel? } | null>` to `choose`: the dialog opens **at once** with a loader and shows the body when it arrives (`null` or a failure closes it, answered `null`) — never make the user wait on a blank screen before it opens. Dialogs are shown one at a time, in the order asked. Anything that ends in a public or irreversible action (e.g. adding a release to MusicBrainz) goes through it, with the safe button first.

- `defaultSettings` entries can be `kind: "checkbox" | "textInput" | "select"`.
- A discovery anchor can set `openLabel` to name the app its `openUri` opens (e.g. "MusicBrainz Picard"); when `url` differs from `openUri`, the web page gets its own "Open in …" action. Both are generic — no provider branching in `contextualActions.ts`.

Display metadata (label, color, acronym, color variants) must **not** be hardcoded in components. Each service class declares `static readonly display: ProviderDisplay`. `ServiceRegistry.register()` reads it automatically and calls `providerDisplayRegistry.register()`. Components call `providerDisplayRegistry.get(key)` for display info.

Unregistered API platforms (youtubeMusic, deezer, appleMusic, etc.) that appear in `TrackMetadata.apiProvider` from external APIs have built-in defaults pre-loaded in `src/base/providerDisplay.ts`.

## Shortcuts & hints

> **Philosophy**: Every keyboard shortcut is user-rebindable, and every on-screen hint must reflect the _live_ binding (default + user override). Never hardcode a key label that maps to a registered shortcut — if a user remaps it in Settings, the hint must update too.

How it fits together:

- Register shortcuts with `useShortcuts({ id, shortcuts: [{ id, defaultShortcut, label, handler }], ... })`. The `id` (e.g. `sessionsModal.delete`) is the stable key the override is stored against. Dispatch already applies overrides — never call `useInput` directly (the only one lives in `ShortcutDispatcher`).
- **Hints must reference the shortcut `id`, not a literal.** Use the shared `Hint` component:
    - `<Hint label="Delete" shortcutId="sessionsModal.delete" />`
    - `<Hint label="Navigate" shortcutIds={["settingsModal.up", "settingsModal.down"]} />` (resolved literals joined with `/`)
    - The legacy `shortcut="Esc"` string prop is **only** for keys not backed by the registry (e.g. keys owned by third-party ink inputs like `ink-text-input`/`ink-select-input`, or the rebind-capture cancel). Add a comment when you use it.
- There are two hint surfaces, both already config-aware — reuse them, don't reinvent:
    - **Modals** render their own footer hints with `Hint` (resolves via the `useShortcutLiteral` hook).
    - **Panels** publish `hintLines` through `useShortcuts`; `DynamicHintBar` renders them from the registry.
- Key-label formatting (`Enter`, `Esc`, `Del`, `↑`, `↓`, …) lives in **one** place: `getShortcutLiteral()` in `src/types/actions.ts`. Add new key labels to its `KEY_LABELS` map, not in components.
- Flow contextual actions (the `ActionBar`) derive their registry ids from `getContextualShortcutIds(action)` — the single source of truth for the `taskList.contextual.*` id scheme, shared by registration (`useKeyHandlers`) and display (`ActionBar`).

## Active vs. disabled code

Registered metadata services: `spotify`, `youtube`. Discovery services: `songlink` (opt-in), `musicBrainz`, `claude` (opt-in, last resort — see [docs/projects/p29/tasks.md](docs/projects/p29/tasks.md)). Download services: `ytdlp`, `soulseek`.

## Dev commands

```bash
yarn run dev  # start the TUI (use this)
yarn run type-check  # Check typescript errors (src/, tests/ and the TUI harness)
yarn run lint  # Check eslint errors (src/, tests/, scripts/)
yarn run format:check  # Check prettier (yarn run format to fix)
yarn test  # Vitest unit + e2e tests (yarn run test:coverage for unit coverage)
```

## TUI test harness

`scripts/tui-test/` is a headless scenario runner for validating user flows and visual appearance. See [scripts/tui-test/README.md](scripts/tui-test/README.md) for full documentation.

```bash
yarn tsx scripts/tui-test/cli.ts <scenario.json>           # JSON output
yarn tsx scripts/tui-test/cli.ts <scenario.json> --pretty  # human-readable
yarn tsx scripts/tui-test/cli.ts <scenario.json> --profile # + per-component render profiling
```

### Render profiling

`--profile` (or `"profile": { "enabled": true }` in a scenario) boots the app through `src/profiling/profiledEntry.tsx`, which installs a React devtools hook and reads per-component render timing/counts/reasons on every commit, attributed to each keystroke. The harness reports a per-component table, a per-interaction breakdown, axis-E Ink output cost, and **anomalies** (component-agnostic thresholds, so new components are covered automatically). See [scripts/tui-test/README.md](scripts/tui-test/README.md#render-profiling) and [docs/projects/p18/tasks.md](docs/projects/p18/tasks.md). The `render profile` vitest test fails CI on `error`-severity anomalies (render cascades); ms budgets are advisory `warn`s.

## Performance rules

A frame is the budget: Ink repaints the whole screen for every React commit, whatever changed. Measure with the suite in [scripts/tui-test/README.md](scripts/tui-test/README.md#performance-suite) (`perfSuite.ts` + `perfCompare.ts`) before and after a change that touches a hot path, and keep these rules:

- **Never subscribe to every task.** `tasks.map((t) => t.subscribe(...))` in an effect is O(N²): it is re-created when the task list changes and every subscription replays its callback at once. To react to "something changed", use `Task.subscribeToAny(cb)` (once per frame, however many tasks changed); to know who waits for the user, use `pendingPrompts` (`src/base/task/pending-prompts.ts`, fed by `TaskPrompt`). If a per-task subscription is really needed, pass `{ immediate: false }` when you already read the state. Pass `persistCurrent` a function, not a snapshot array, so the snapshots are built when the save happens.
- **A component that follows the session store must not re-render for a save that changes nothing it shows.** Use `useSyncExternalStore` with `subscribeToSessions` and a snapshot that is a primitive or a stable reference (`useArchivedCount`, `useCurrentSessionName`). Modals are always mounted: gate their data hooks on `isVisible` (`useSessions(query, enabled)`, `useArchive(query, enabled)`) so a closed modal costs nothing.
- **Snapshots are immutable once handed out.** `src/sessions/serialize.ts` remembers the JSON text of each task snapshot and session by object identity; changing one in place, without `notify`, would save stale text. Build a new object (`Task.get()` already does after every notification).
- **No synchronous file-system calls in render or in the download path.** Use `useFileExists` in components and `fs.promises` (see `utils/tempFile.ts`) in the pipeline.
- **Animations go through `useGlobalTicker` / `AnimatedIcon`**, never a library spinner with its own timer (it ignores Settings → Animations).
- **The footer follows the log level setting** and only re-renders when its text changes.
- **Sounds ship as Ogg Vorbis, never as WAV/MP3** (the npm package was 131 MB, 125 of them sounds). Keep a sample's base name, drop the original in a folder and run `node scripts/encode-sounds.mjs <src> <dest>`: it keeps each file's sample rate (the cue sheet's `pitched(96000, …)` and `loopSamples` count in source samples; Opus would force 48 kHz) and a unit test enforces a size budget. The drone is cut to `DRONE_SECONDS`. Check a re-encode without listening: `scripts/render-intro-mix.ts` + `scripts/compare-audio.mjs`.

## Tips for common mistakes

Prefer use of import aliases from `package.json`

```ts
import { APP_VERSION } from "../../constants"; // before
import { APP_VERSION } from "#constants"; // after
```

### Box shrinking

By default, `Box` from `ink` are shrinking with if there is no enough space **by default**.
Often it's better to specify explictly `flexShrink={0}`.

```
import { Box, Text } from "ink";
<Box flexDirection="row" flexShrink={0}>
```

### Multiple Box with `overflow="hidden"`

When multiple boxes have overflow, it make the child text overflow, even above parents.

```
<Box overflow="hidden">
  <Box overflow="hidden">
    <Text>Content</Text>
  </Box>
</Box>
```

### Don't indent with space characters

Building indentation/spacing by prepending literal spaces to a string (e.g. `"  ↳ " + name`) breaks once the
column narrows below the string's own width — the leading spaces don't participate in `wrap="truncate-end"`
or flex-shrink the way layout properties do, so text clips or overlaps unpredictably on small screens.

Use `marginLeft`/`paddingLeft` (or a fixed-`width` `Box` spacer) instead — **and give every fixed/decorative
element its own `flexShrink={0}`**, not just the outer row. A bare `<Text>` sibling in a row defaults to
`flexShrink={1}`, so once the row is too narrow for it + its sibling, Yoga shrinks it to **zero width and it
vanishes silently** — the row's `marginLeft`/`gap` still reserve their spacing, so you get blank space where
the glyph should be, easy to mistake for a rendering/font issue instead of a missing `flexShrink={0}`:

```
// before — the "↳" can vanish on a narrow column, leaving blank space in its place
<Box flexDirection="row" gap={1} marginLeft={1}>
  <Text>↳</Text>
  <Text wrap="truncate-end">{name}</Text>
</Box>

// after — wrap every fixed element in its own flexShrink={0} Box; only the
// text that should actually truncate (wrap="truncate-end") is left shrinkable
<Box flexDirection="row" gap={1} marginLeft={1}>
  <Box flexShrink={0}>
    <Text>↳</Text>
  </Box>
  <Text wrap="truncate-end">{name}</Text>
</Box>
```
