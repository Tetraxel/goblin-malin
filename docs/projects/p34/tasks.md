# P34 — Extensions: Tasks

> **Status: proposed** (2026-11-25). Nothing is built yet.

## Context

Goblin Malin is built around registries: metadata, discovery, download and stem providers, the toolbar's Actions menu, and the chat agent's tools. Each is declared once and read generically. But all of them can only be filled **from inside the bundle**, in `initMusicApp()`. Someone who needs a feature that is too specific for the base project has to fork the app.

Some examples of such features:

- an Actions item that removes every track already in their music library folder;
- a provider for a niche platform or a private server;
- a Claude tool or a Claude-powered action for their own workflow;
- post-download automation (import into beets, copy to a NAS, ReplayGain, a notification).

**An extension** is a folder of JavaScript the app loads at start-up. It receives one object, `goblin`, through which it adds things to the same registries the app uses.

What must hold:

- **The API is handed in, never imported.** The app is a bundle (Ink is bundled and patched) and `ServiceRegistry.register()` checks `ctor.prototype instanceof ServiceBase` ([service-registry.ts](../../../src/base/service-registry.ts)). An extension that imported its own copy of the app or of Ink would get other classes, which fails that check, or a stock Ink. So `activate(goblin)` receives the base classes and registries. Types for authors come from a published `goblin-malin/extension-api` entry.
- **A curated, versioned surface.** `goblin` exposes what an extension needs, not the internals. The internals can keep being refactored. A change that breaks extensions bumps `apiVersion`.
- **Honest trust.** An extension runs in the app's process with the app's rights (files, network, the user's credentials). Node has no real sandbox, and the app does not pretend to have one. It asks before an extension's first load, asks again when its files change, and each extension can be switched off.
- **Same rules as built-in code.** Changes to tracks go through the named `DownloadTask` methods and their guards. Anything irreversible asks through `dialogBridge`. Child processes are killed with the app and never inherit secrets. Calls to the outside world have a timeout. Providers are read generically, never by key.
- **User data survives the extension.** Removing or switching off an extension never loses tracks, sources, overrides or settings that came from it.
- **A broken extension never stops the app.** It is logged, marked as failed in Settings → Extensions, and the app starts without it.

### Out of scope (first version)

- **Custom UI components.** Exposing the patched Ink would let an extension break the "one key = one frame" rule ([CLAUDE.md](../../../CLAUDE.md#performance-rules)). Settings rows, dialogs, Actions items, provider cells and columns cover the needs listed above.
- **Loading without a restart.** Turning an extension on or off, or installing one, takes effect at the next start. The registries have no per-owner unregister today, and a half-unloaded provider is not worth the risk.
- **Pipeline transforms** (`transformTags`, a custom file-name template). Useful, but they change the output of every track. They can come later, after events have been in use for a while.
- **A sandbox or a permission system.** See "Honest trust" above.

## What the user sees

### On disk

```
<data folder>/extensions/
  library-dedupe/
    extension.json      { "name": "library-dedupe", "displayName": "Library dedupe",
                          "version": "1.0.0", "apiVersion": 1, "entry": "index.js",
                          "description": "Remove tracks already in a folder of yours" }
    index.js            export default function activate(goblin) { … }
    node_modules/       (its own dependencies, if any)
```

### First start after an extension is added

A confirm dialog, once per extension:

```
╭─ Load the extension "Library dedupe"? ────────────────────────────────────────╮
│ library-dedupe 1.0.0 · <data folder>/extensions/library-dedupe                │
│ Remove tracks already in a folder of yours                                    │
│                                                                               │
│ An extension runs inside Goblin Malin with the same rights: it can read and   │
│ change your files, use the network and read your provider credentials. Only   │
│ load extensions from people you trust.                                        │
│                                                                               │
│              [ Not now ]   [ Never ]   [ Load it ]                            │
╰───────────────────────────────────────────────────────────────────────────────╯
```

- If any of the extension's files change, the dialog is shown again (the hash recorded with the answer no longer matches).
- **Not now** asks again at the next start. **Never** keeps it off until the user turns it on in Settings.

### Settings → Extensions

One row per extension found:

- its name, version and state (loaded · off · waiting for your answer · failed: _reason_ · needs API v2, this app has v1);
- an on/off switch;
- the settings the extension declares, drawn with the existing kinds (checkbox / text / select) and `settingsRows`;
- actions: _Open the extensions folder_, _Show its log lines_.

A dim line under the list: "Changes take effect at the next start."

### Everywhere else

What an extension adds looks like what the app has:

- its Actions items in the Actions menu;
- its providers in Settings, the first-run picker, the columns and the sources;
- its tools in the chat.

Its log lines are prefixed with the extension's name.

## Design

### The `goblin` object (API v1)

| `goblin.`                                                                                 | What it does                                                                                                       | Built on                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `version`, `apiVersion`, `extension` (own name, folder, version)                          | Who is running and where                                                                                           | `APP_VERSION`                                 |
| `log.debug/info/warn/error`                                                               | Log lines prefixed with the extension's name                                                                       | `globalLogger`                                |
| `settings.get(key)`, `settings.onChange(fn)` + manifest/activate `defaultSettings`        | The extension's own settings, stored under `extensions.<name>` in `settings.json`, edited in Settings → Extensions | `SettingsStore`                               |
| `secrets.get/set(key)`                                                                    | Credentials, its own keys only (`<name>.<key>`), never in `process.env`                                            | `appSecrets`                                  |
| `actions.register(item)`                                                                  | An Actions menu item (`id` is prefixed with the extension's name)                                                  | `actionsMenuRegistry`                         |
| `dialog.confirm/choose/input/matrix`                                                      | Asking the user; `null` when nobody answers                                                                        | `dialogBridge`                                |
| `tasks.list()`, `tasks.get(id)`, `tasks.onChange(fn)`                                     | Read-only views of the tracks and collections (frozen plain objects)                                               | `TaskOrchestrator`, `Task.subscribeToAny`     |
| `tasks.add(urls)`, `tasks.remove(ids)`, `tasks.run(ids)`, `tasks.stop(ids)`               | The same operations as the import dialog, Delete, Run selected, Stop                                               | `taskFactory`, `removeTasks`, `runController` |
| `tasks.edit(id).setMetadataOverride(…)`, `.selectDownloadSource(…)`, …                    | Named `DownloadTask` methods, through a write guard like the agent's (refuses a busy task, respects `taskLock`)    | `DownloadTask`, `agent/taskAccess.ts`         |
| `on(event, fn)`                                                                           | Events (below)                                                                                                     | **new** `appEvents` emitter                   |
| `spawn(cmd, args, opts)`                                                                  | A child process: secrets stripped, killed with the app, stopped by an `AbortSignal`                                | `registerAgentCleanup`, `killProcessTree`     |
| `fetch(url, init)`                                                                        | `fetch` with a default timeout                                                                                     | `fetchWithTimeout`                            |
| `files.readTags(path)`, `files.scanAudio(folder)`                                         | The app's own tag reader, so extensions do not each bring one                                                      | the tagging utils                             |
| `claude.ask(prompt, { schema })`                                                          | A one-shot question to Claude (the user's CLI, sandboxed, no tools), behind the existing consent                   | `ClaudeClient`                                |
| `agent.defineTool(def)`                                                                   | A chat tool (name prefixed `<name>__`)                                                                             | `defineAgentTool`                             |
| `MetadataService`, `DiscoveryMetadataService`, `DownloadService`, `StemSeparationService` | Base classes to extend                                                                                             | the existing classes                          |
| `providers.metadata/discovery/download/stems.register(key, Class)`                        | Registers a provider (key prefixed `<name>.`)                                                                      | the four registries                           |

`activate(goblin)` may be `async` and may return a `dispose()` function, which is called when the app closes.

### Events

| Event             | Payload                      | When                                                          |
| ----------------- | ---------------------------- | ------------------------------------------------------------- |
| `app.ready`       | —                            | The first render is done and the session is loaded            |
| `track.saved`     | track view + `path` + format | The tagged file is in the output folder                       |
| `track.failed`    | track view + stage + message | A run ended in error                                          |
| `collection.done` | collection view + counts     | Every track of an album / playlist / group is saved or failed |
| `stems.saved`     | track view + stem paths      | A stem file was saved                                         |
| `app.exit`        | —                            | Before the app quits (a short time limit)                     |

Rules for events:

- Handlers run **after** the fact, async, with a timeout. They never block or slow the pipeline, and a handler error is logged, never rethrown.
- A track's handlers run in order for one extension (two `track.saved` handlers of the same extension never overlap for one track).
- Payloads are frozen plain objects (the same views as `tasks.list()`), never the live task.

### Names and keys

Everything an extension registers is prefixed with its name:

- Actions ids: `library-dedupe.removeOwned`
- Provider keys: `bandcamp.bandcamp`
- Tool names: `library_dedupe__find_owned`

This keeps a later built-in provider, or another extension, from taking the same key. It also lets the app know which extension a stored key belongs to when that extension is missing (see T34.9).

### Loading

1. `start()` ([src/index.tsx](../../../src/index.tsx)) becomes async. After `initMusicApp()` and before `render()`, it awaits `loadExtensions()`.
2. `loadExtensions()` lists `<data folder>/extensions/*/extension.json` and checks each manifest (name format, `apiVersion`, `entry` inside the folder).
3. For each extension that is on and trusted (or `--extension <path>`, see T34.2), it `import()`s the entry with `pathToFileURL` and awaits `activate(goblin)` under a **5 s** limit.
4. Trust questions are asked **after** the first render, through `dialogBridge` (no UI exists before it). An extension that was waiting for an answer is loaded at the next start, in line with "changes take effect at the next start".
5. Whatever an extension registered before failing stays registered for this run, and is listed in Settings → Extensions with the failure. Undoing partial registrations is not worth it, since a restart without the extension is clean.

### Trust record

The app writes `extensions.json` in the data folder:

```json
{ "library-dedupe": { "answer": "load", "hash": "sha256:…", "at": "2026-11-25T10:12:00Z" } }
```

- The hash covers every file of the extension's folder except `node_modules/`. A dependency change shows up through the `package-lock.json` or `yarn.lock`, which are hashed.
- When the hash differs from the recorded one, the extension is not loaded, and the dialog is asked again.

## Tasks

### T34.1 — The API surface and its types

- `src/extensions/api/` builds the `goblin` object for one extension (its name decides the prefixes, its settings section and its logger).
- `src/extensions/api/types.ts` holds the public types, with no import of internals that are not part of the API.
- Add a `"./extension-api"` export to `package.json` and an entry to `tsup.config.ts` that emits only the `.d.ts`.
- `EXTENSION_API_VERSION = 1` in `#constants`.
- A unit test fails when a type the public file exports changes shape without a version change (a committed snapshot of the generated `.d.ts`, refreshed with a script, like `agent:tools --write`).

### T34.2 — The loader

- Write `src/extensions/loader.ts` covering manifest validation, `import()`, the 5 s limit, isolation (one failing extension does not affect the others) and the per-extension state (`loaded` / `off` / `untrusted` / `failed` + reason / `incompatible`).
- `start()` becomes async (`cli.ts` awaits it).
- Add a `--extension <path>` CLI flag (repeatable) that loads a folder without the trust record, for authors working on one. It is never saved, and the log says so in a warning at each start.
- Add `GOBLIN_NO_EXTENSIONS=1` (and `--no-extensions`) to start without any. This is the way out of an extension that breaks the app, and the README names it.
- Call `dispose()` on `app.exit`.

### T34.3 — Trust and Settings → Extensions

- Write `extensions.json` (above), the hash of a folder (async `fs.promises`, no sync calls), and the first-load dialog (safe button first: **Not now**).
- Add a **Settings → Extensions** section built from the loader's states, the switches, the extension's declared settings (existing row kinds) and `settingsRows` / `settingsStatus`, plus the dim note about the restart.
- Turning one off writes `answer: "off"`. Turning one on that was never trusted shows the dialog.

### T34.4 — Settings, secrets, log, dialogs, Actions items

- Extension settings go under `extensions.<name>` in `settings.json`. **Check and test** that `writeMusicSettings` / `deepDiff` keeps a section whose defaults are unknown (the extension is off or missing). If it does not, store extensions in their own top-level key that no diff touches.
- Extension secrets go through `appSecrets` under `<name>.<key>`. A `setupWizard` declared by an extension's provider works as it does for built-ins (its keys are adopted from the environment like the others).
- `actions.register()` prefixes the id, wraps `run` so a throw becomes a log line with the extension's name, and wraps `unavailableReason` so a throw greys the item out with "This extension failed: …".

### T34.5 — Tasks

- Read views: one compact, frozen object per task, with id, kind, title / artist / album, ISRC, state, `isBusy`, saved file, sources and parent collection. Reuse the agent's views (`agent/views`) where they fit, so there is one definition of "what a task looks like from outside".
- `tasks.onChange(fn)` on top of `Task.subscribeToAny`, at most once per frame, never a per-task subscription ([performance rules](../../../CLAUDE.md#performance-rules)).
- Writes go through an `extensionWrite()` guard, the agent's `agentWrite()` without the turn budget or the undo journal. It refuses a busy task and a task Claude holds, and calls the same named methods. `remove` uses the same path as Delete (it refuses busy tasks and asks through `confirmReset` where Delete would).
- `tests/unit/extensionTasks.test.ts` checks that a write to a busy task is refused, a removed group keeps its tracks consistent (`utils/groupTasks.ts`), and user data (`userSources`, `metadataOverride`) survives every write.

### T34.6 — The sample extension: library dedupe

`examples/extensions/library-dedupe/` is the first real user of the API. It adds an Actions item, _Remove tracks already in my library_, which works like this:

1. It asks for the folder (remembered in its settings) and scans its audio files with `files.scanAudio` (tags read in the background, a loader dialog while it runs).
2. It matches on ISRC, else on normalised artist + title + duration within 3 s.
3. It shows the matches with `dialog.choose`, then asks before removing them.

Writing it is what tests the `tasks` API: what it misses goes into T34.5. A TUI harness scenario loads it with `--extension` and a fixture folder.

### T34.7 — Events and child processes

- Create `src/base/appEvents.ts`, a typed emitter. Emit each event where it happens:
    - `track.saved`: where `savedFile` is written in `DownloadTask`
    - `track.failed`: the run's error path
    - `collection.done`: in `CollectionTask` / `reconcileGroups` when the last child ends
    - `stems.saved`: `savedStems`
    - `app.ready` / `app.exit`
- Handlers are called through a small dispatcher that adds the timeout (30 s by default; an extension can ask for more for one handler, up to 10 min), the per-extension ordering, and the error logging.
- `goblin.spawn()` strips every key `appSecrets` holds from the child's environment, registers `killProcessTree` cleanup, and takes an `AbortSignal`.
- A second sample, `examples/extensions/after-save-command/`, runs a command line from its settings for each `track.saved` (JSON on stdin, `{path}` / `{artist}` / `{title}` placeholders). It covers "user scripts" in any language without a new built-in feature.

### T34.8 — Claude

- `goblin.agent.defineTool()` checks the same declaration as `defineAgentTool` (summary, schema, `kind`, `locks`, `example`) and prefixes the name. The handler receives the same `ctx` (`confirm`, `turn`), and writes go through `agentWrite()`, so the turn budget and undo work.
- The catalogue test (`docs/agent-tools.md`) covers built-in tools only. `yarn run agent:tools` lists extension tools in a separate section when they are loaded.
- The MCP server's allowlist and the CLI's `--allowedTools` read the registry already, so extension tools reach Claude without other changes. A test checks it with a fake extension.
- `goblin.claude.ask(prompt, { schema })` goes through `ClaudeClient`: the same consent as the Claude provider (asked once, `null` when refused), no tools, web search only if the extension asks for it and the user allowed the Claude provider. Its cost is logged like the provider's.

### T34.9 — Providers, and what is left when an extension is gone

- `goblin.providers.*.register(key, Class)` prefixes the key and calls the existing `register()` with the class given by `goblin`'s base classes (so the `instanceof ServiceBase` check passes).
- **Survival when an extension is missing or off.** Tasks saved with its platform keep their metadata groups, sources, `userSources` and overrides:
    - its platform is shown with a fallback display: the key, plus "extension _name_ is not loaded";
    - its sources cannot be re-fetched, and say why;
    - its download rows offer no download;
    - its settings stay in `settings.json`.
    - When the extension is back, everything works again with no migration.
- Test with a session made with a fake provider extension, reloaded without it (nothing lost, no crash, restart / re-discovery / Run all leave its data alone), then with it again.
- Check every place that calls `registry.getConstructor(key)` / `providerDisplayRegistry.get(key)` with a key from saved data, and handle `undefined`.

### T34.10 — Documentation

- `docs/extensions.md`, the authoring guide:
    - the folder layout and the manifest;
    - `activate`;
    - every `goblin` member with an example;
    - the rules (named methods, dialogs for anything irreversible, no sync file system calls, timeouts, `spawn` rather than `child_process`);
    - how to work on one with `--extension`;
    - TypeScript setup with `goblin-malin/extension-api`;
    - versioning.
- Add a section in [CLAUDE.md](../../../CLAUDE.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) (the loader, the API boundary, the survival rule), a paragraph in the README, and a CHANGELOG entry.
- Add an `add-extension` skill, like `add-metadata-provider`, so Claude Code can write an extension for a user from a description.

### T34.11 — Installing extensions (later)

- `goblin-malin ext add <npm package | git URL | folder>` installs into the extensions folder (with `npm install --omit=dev` in it for dependencies). `ext list` and `ext remove <name>` go with it.
- Installing never trusts: the first-load dialog is still asked at the next start.
- A list of known extensions in the README (links only, no review implied).

## Order

1. **T34.1 – T34.4 + T34.6**: the loader, trust, settings and Actions items, with the library-dedupe sample as the proof. This is the first useful release.
2. **T34.5** (fed by what T34.6 needed) **+ T34.7**: tasks and events. Post-download automation works from here.
3. **T34.8**: Claude tools and `claude.ask`.
4. **T34.9**: providers, the heaviest step because of the survival work.
5. **T34.10** along the way (each step documents what it adds); **T34.11** once a few extensions exist.

## Risks

- **API lock-in.** Every member of `goblin` is a promise. Start small, add members when a real extension needs them (T34.6 is that extension), and mark new members `@experimental` for one release before they count towards `apiVersion`.
- **Performance.** An extension can still do slow synchronous work in an event handler or an `unavailableReason`. The guide says not to. `unavailableReason` is called each time the menu opens, so it is timed, and a slow one (> 50 ms) gets a warning in the log naming the extension.
- **Support load.** Bug reports caused by an extension. The log names the extension of each line it writes, the crash report lists the loaded extensions with their versions, and `--no-extensions` is the first thing to try.
- **Credentials.** The trust dialog says plainly that an extension can read them. `secrets` keeps extensions' keys apart from each other by convention, not by force.
