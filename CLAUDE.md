# Claude Code — Project Context

## Quick orientation

- **What this is:** A keyboard-driven terminal UI (Ink/React) for downloading and tagging music tracks from streaming platforms.
- **Current state:** Working POC for one pipeline — Spotify URL → YouTube search → yt-dlp download.
    - Run the local script [TREE.ps1](TREE.ps1) to get the full project tree
- **Target state:** See [README.md](README.md) and [docs/designs/](docs/designs/) (screenshots contain the most detail).

## Key documents

- [docs/audit/README.md](docs/audit/README.md) — Codebase audit: architecture, data flow, file structure, what's active vs. disabled. Read this before exploring the codebase.
- [docs/projects/README.md](docs/projects/README.md) — High-level technical projects needed to reach the target product.

## Provider extensibility

> **Philosophy**: We don't want to hardcode metadata/download providers! They must be interchangeable and extensible. The app should be able to support any number of metadata and download providers without requiring changes to the core flow logic or UI components.

Adding a new provider should require changes in only two places:

1. A new service class file (the implementation)
2. One `.register(MyService)` call in `MusicDownloadFlow`'s constructor

Display metadata (label, color, acronym, color variants) must **not** be hardcoded in components. Each service class declares `static readonly display: ProviderDisplay`. `ServiceRegistry.register()` reads it automatically and calls `providerDisplayRegistry.register()`. Components call `providerDisplayRegistry.get(key)` for display info.

Unregistered API platforms (youtubeMusic, deezer, appleMusic, etc.) that appear in `TrackMetadata.apiProvider` from external APIs have built-in defaults pre-loaded in `src/base/providerDisplay.ts`.

## Shortcuts & hints

> **Philosophy**: Every keyboard shortcut is user-rebindable, and every on-screen hint must reflect the *live* binding (default + user override). Never hardcode a key label that maps to a registered shortcut — if a user remaps it in Settings, the hint must update too.

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

Only two metadata services are registered: `spotify` and `youtube`. Only one download service is registered: `ytdlp`.

## Dev commands

```bash
yarn run dev  # start the TUI (use this)
yarn run type-check  # Check typescript errors
yarn run lint  # Check eslint errors
```

## Tips for common mistakes

Prefer use of import aliases from `package.json`

```ts
import { APP_VERSION } from "../../constants";
import { APP_VERSION } from "#constants";
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
