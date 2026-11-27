# Writing a Goblin Malin extension

An **extension** is a folder of JavaScript that Goblin Malin loads at start-up. It receives one object, `goblin`, and through it adds things to the same registries the app's own features use: items of the toolbar's **Actions** menu, handlers for what happens (a track saved, an album done), **tools for the chat with Claude**, one-shot questions to Claude, and whole **providers** (a platform to read links from, a discovery service, a download source, a stem separator).

It is for features too specific for the base project: "remove the tracks I already have", "import every saved track into beets", "copy to my NAS", "a provider for my private server". The design is in [P34](projects/p34/tasks.md); this page is the author's guide.

- [Quick start](#quick-start)
- [The folder and the manifest](#the-folder-and-the-manifest)
- [`activate(goblin)`](#activategoblin)
- [The `goblin` object](#the-goblin-object)
- [Events](#events)
- [Providers](#providers)
- [Claude](#claude)
- [The rules](#the-rules)
- [Trust, and what the user sees](#trust-and-what-the-user-sees)
- [Installing and sharing](#installing-and-sharing)
- [TypeScript](#typescript)
- [Versions](#versions)

Two complete examples are in [`examples/extensions/`](../examples/extensions/): **library-dedupe** (an Actions item, a scan of a folder, a Claude tool) and **after-save-command** (a command line of the user's for each saved track).

## Quick start

```bash
goblin-malin ext new my-extension            # a folder with extension.json, index.js and a README
goblin-malin --extension ./my-extension      # start the app with it, without the trust question
```

From a checkout of the repository: `yarn run dev --extension ./my-extension` (or `GOBLIN_EXTENSION=./my-extension yarn run dev`).

Edit `index.js`, restart the app, and look at Settings → Extensions (its state, its settings, its log lines) and at `app.log` (every line it writes is prefixed with `ext:my-extension`).

## The folder and the manifest

```
<data folder>/extensions/
  library-dedupe/
    extension.json
    index.js
    package.json        (optional: "type": "module", its dependencies)
    node_modules/       (its own dependencies, if any)
```

`extension.json`:

```json
{
    "name": "library-dedupe",
    "displayName": "Library dedupe",
    "version": "1.0.0",
    "apiVersion": 1,
    "entry": "index.js",
    "description": "Remove from the list the tracks already in a music folder of yours",
    "author": "You",
    "homepage": "https://github.com/you/library-dedupe",
    "settings": {
        "libraryFolder": { "kind": "textInput", "label": "Library folder", "defaultValue": "" },
        "matchDuration": { "kind": "checkbox", "label": "Also compare durations", "defaultValue": true },
        "mode": { "kind": "select", "label": "Mode", "defaultValue": "fast", "options": ["fast", "thorough"] }
    }
}
```

| Field                                        | Required | What it is                                                                                                                              |
| -------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                       | yes      | 2–40 lower case letters, digits and dashes, starting with a letter. It prefixes everything the extension registers.                      |
| `version`                                    | yes      | Its own version (`1.0.0`).                                                                                                               |
| `apiVersion`                                 | yes      | The API version it was written for. The app loads it only when it is the app's own (today: **1**).                                       |
| `entry`                                      | no       | The ES module to load, inside the folder. Default `index.js`.                                                                            |
| `displayName`, `description`, `author`, `homepage` | no | Shown in Settings → Extensions and in the trust question.                                                                               |
| `settings`                                   | no       | Its settings, drawn in Settings → Extensions with the app's own rows: `checkbox`, `textInput`, `select` (each with a `label` and a `defaultValue`). |

The entry is an **ES module**: `export default function activate(goblin) { … }` (an `export function activate` works too). A `.js` file is an ES module when the folder's `package.json` says `"type": "module"`, or name it `index.mjs`.

## `activate(goblin)`

```js
// @ts-check
/** @param {import("goblin-malin/extension-api").GoblinApi} goblin */
export default async function activate(goblin) {
    goblin.actions.register({ id: "hello", label: "Say hello", description: "…", run: () => goblin.dialog.notify("Hi", "Hello!") });
    const off = goblin.on("track.saved", ({ track, path }) => goblin.log.info(`Saved ${track.title} to ${path}`));
    return () => off(); // called when the app closes (or return { dispose })
}
```

- It may be `async`. It has **5 seconds**: an extension that takes longer is marked as failed (do slow work later, in an action or an event).
- Whatever it registers before throwing stays for this run; the extension is listed as failed with the error, and the others load normally. A broken extension never stops the app: `goblin-malin --no-extensions` (or `GOBLIN_NO_EXTENSIONS=1`) starts without any, the way out when one misbehaves.
- What it returns: nothing, a `dispose()` function, or `{ dispose }`. `dispose()` runs when the app closes (with `app.exit` handlers, about 2 seconds in all).
- Changes take effect at the next start: there is no unloading while the app runs.

## The `goblin` object

Everything is typed in [`src/extensions/api/types.ts`](../src/extensions/api/types.ts) (the contract; published as `goblin-malin/extension-api`).

### Who and where

```js
goblin.apiVersion; // 1
goblin.version; // the app's version, "0.3.0"
goblin.extension; // { name, displayName, version, folder, dataDir, development }
goblin.paths.appData; // the app's data folder
goblin.paths.outputDir(); // where tracks are saved (Settings → Download), read now
```

`extension.dataDir` is a folder of its own (`<data folder>/extension-data/<name>/`) for files it keeps; `development` is true when it was loaded with `--extension`.

### `log`

```js
goblin.log.info("Scanned 1234 files"); // also debug, warn, error; a second argument adds details to app.log
```

Lines go to the log panel and to `app.log` prefixed with `ext:<name>`, and the latest 300 are in Settings → Extensions → "Show its log lines". Never `console.log`: the screen belongs to the interface.

### `settings`

```js
goblin.settings.get("libraryFolder"); // the stored value, else the declared default
goblin.settings.set("libraryFolder", "/music");
goblin.settings.all();
goblin.settings.declare({ extra: { kind: "checkbox", label: "Extra", defaultValue: false } }); // more, from code
const off = goblin.settings.onChange((all) => { … });
goblin.settings.rows((status) => [{ kind: "action", label: "Re-scan now", icon: "↻", run: () => … }, { kind: "note", text: status ?? "" }]);
goblin.settings.status(async () => `Last scan: ${await lastScanDate()}`);
```

They are stored in `settings.json` under `extensions.<name>` (only what differs from the defaults) and edited in Settings → Extensions with Save / Cancel like the rest. `rows` is called every time Settings is drawn: keep it cheap and off the disk; what needs reading goes into `status`, which Settings awaits in the background when it opens.

### `secrets`

```js
goblin.secrets.set("token", "…");
goblin.secrets.get("token");
goblin.secrets.delete("token");
```

Kept in the app's `.env` as `GOBLIN_EXT_<NAME>__<KEY>` and **never in the environment** of a program the app starts (yours included, through `goblin.spawn`). An extension's provider can also declare a `static setupWizard`, which works exactly as for the built-in ones.

### `storage`

```js
await goblin.storage.set("lastScan", { at: Date.now(), files: 1234 });
const last = await goblin.storage.get("lastScan");
await goblin.storage.delete("lastScan");
```

A small JSON file in `dataDir`, written in the background, one write at a time.

### `actions`

```js
goblin.actions.register({
    id: "removeOwned", // stored as "library-dedupe.removeOwned"
    label: "Remove tracks already in my library",
    description: "One line under the label: what it does",
    unavailableReason: () => (goblin.tasks.list({ kind: "track" }).length === 0 ? "The list has no track" : undefined),
    run: async () => { … },
});
```

An item of the toolbar's **Actions** menu (for things done to the whole list). `unavailableReason` is asked every time the menu opens: the item stays listed, greyed, with the reason. Keep it under 50 ms (a slower one is named in the log). `run` goes after the menu has closed; a throw is logged with the extension's name, and a throw in `unavailableReason` greys the item with "This extension failed: …".

### `dialog`

```js
const i = await goblin.dialog.confirm({ title: "Remove 3 tracks?", message: "…", choices: [{ label: "Keep them", tone: "primary" }, { label: "Remove", tone: "danger" }] });
const pick = await goblin.dialog.choose({ title: "Pick one", items: [{ label: "A", detail: ["…"] }], noneLabel: "None" });
const text = await goblin.dialog.input({ title: "Your library", message: "The folder", initialValue: "/music" });
const grid = await goblin.dialog.matrix({ … }); // two sets of checkboxes and how they depend on each other
await goblin.dialog.notify("Done", "Removed 3 tracks.");
```

Every call answers `null` when the dialog is dismissed **or when nobody can answer** (no UI yet, or a test run): never read `null` as a yes. Put the safe button first. A list that needs a lookup first opens at once with a loader: pass `body: promise` (it resolves to `{ intro, items, noneLabel }`) and `loadingLabel`.

### `tasks`

What the extension reads of the list are **frozen copies** (`TrackView`, `CollectionView`), never the live tasks:

```js
goblin.tasks.list(); // every task, in list order
goblin.tasks.list({ kind: "track", state: "finished", saved: true, parentId, query: "daft punk" });
goblin.tasks.get(id);
goblin.tasks.selected(); // what the user selected in the list (or the task under the cursor)
const off = goblin.tasks.onChange(() => { … }); // at most once per frame, whatever changed
```

A `TrackView` has the compiled metadata (`title`, `artists`, `album`, `isrc`, `durationMs`, `year`, `fields`), the user's `overrides`, its `sources` (one per metadata result), its `downloads` (each with an `id`), its `savedFile`, its saved `stems`, its `state`, `status` and `busy`.

The same operations as the interface:

```js
await goblin.tasks.add(["https://open.spotify.com/track/…"], { fetchMetadata: true, download: false, start: false });
await goblin.tasks.remove(ids, { reason: "They are in your library." }); // asks the user first; { confirm: false } to skip
await goblin.tasks.archive(ids); // reversible, no question
await goblin.tasks.run(ids); // like Run selected: resolves with why nothing started, or undefined
await goblin.tasks.stop(ids); // or stop() for every run
```

`remove` works like Delete: a busy task stays, an album / playlist / group goes whole or not at all, and the files already saved stay on disk.

Changing a track goes through `edit(id)`, whose methods are the **same named methods the panels call**, with their checks:

```js
const editor = goblin.tasks.edit(id);
await editor.patchMetadata({ trackName: "Title", artists: ["A", "B"], year: 2001, genres: null }); // null clears an override
await editor.addSources(["https://www.deezer.com/track/…"]); // kept across restarts, like the user's own
await editor.removeSource(url);
await editor.selectDownload(downloadId);
await editor.rejectDownload(downloadId, true);
await editor.setOutput({ dir: "/music/incoming", fileName: null });
await editor.setRunFlags({ fetchMetadata: true, download: true });
await editor.save(); // tags + moves the selected download, as "Save" does
await editor.rediscover(); // or rediscover("deezer")
await editor.redownload();
await editor.separateStems({ model: "htdemucs_ft.yaml" }); // needs Settings → Stems set up
```

Each resolves with the new `TrackView`. A change is **refused** (an error whose `code` is `busy`, `locked`, `invalid` or `not-found`) when the pipeline is working on the track, when Claude holds it, or when the value is not valid (an ISRC of the wrong shape). Writes to one track go one at a time.

### `on` (events)

See [Events](#events).

### `spawn`

```js
const { code, signal, stdout, stderr } = await goblin.spawn("beet", ["import", "-q", path], {
    cwd,
    env: { EXTRA: "1" },
    input: JSON.stringify(payload), // written to stdin, then closed
    signal, // stops it (and the programs it started)
    timeoutMs: 120_000, // default 10 minutes
});
```

Use it instead of `child_process`: the program gets the app's environment **without any credential the app keeps**, it is killed with the app (and on Windows with every program it started), and on `signal` or `timeoutMs`. It resolves when the program ends (a non-zero code does not reject); it rejects when the program cannot be started. No shell: pass `/bin/sh -c …` or `cmd /d /s /c …` yourself (see after-save-command).

### `fetch`

```js
const res = await goblin.fetch("https://api.example.com/x", { headers: { … }, timeoutMs: 10_000 }); // default 30 s
```

The global `fetch`, with a time limit. Every call to the outside world must have one.

### `files`

```js
const info = await goblin.files.readTags("/music/a.flac"); // { path, format, sizeBytes, tags, title, artists, album, isrc, durationMs }
const all = await goblin.files.scanAudio("/music", { probeDuration: true, signal, onProgress: (done, total) => … });
```

The app's own tag readers (FLAC and MP3 natively, the rest through ffprobe), with tags named as in Vorbis comments (`TITLE`, `ARTIST`, `ISRC`…). `scanAudio` walks the folder (hidden folders skipped) and reads 8 files at a time.

### `clipboard`, `open`, `reveal`

```js
await goblin.clipboard.write("text"); // and read()
goblin.open("https://musicbrainz.org/…"); // in the browser (or the platform's app)
goblin.reveal("/music/a.flac"); // in the file manager
```

## Events

```js
const off = goblin.on("track.saved", async ({ track, path, format }, { signal }) => { … }, { timeoutMs: 120_000 });
```

| Event             | Payload                                          | When                                                               |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `app.ready`       | —                                                | The interface is up, the session loaded, the intro over            |
| `app.exit`        | —                                                | Before the app quits (about 1 s for every handler)                 |
| `tasks.added`     | `{ ids }`                                        | Tasks joined the list (pasted, imported, by Claude or an extension) |
| `track.saved`     | `{ track, path, format }`                        | The tagged file is in the output folder                            |
| `track.failed`    | `{ track, stage, message }`                      | A run ended in error (`stage`: `metadata`, `download` or `run`)    |
| `collection.done` | `{ collection, saved, failed, total }`           | Every track of an album / playlist / group is saved or failed      |
| `stems.saved`     | `{ track, stems }`                               | Stem files were saved (`stems`: kind → path)                       |

- Handlers run **after** the fact, asynchronously: they never slow the pipeline, and an error is logged with the extension's name, never thrown at it.
- Each has a time limit, 30 s by default (`timeoutMs`, up to 10 minutes). When it is up, `signal` aborts; pass it on to `spawn` and `fetch`.
- The handlers of one extension for one track run one after the other: two `track.saved` of the same track never overlap.
- Payloads are frozen views, like `tasks.get()`.

## Providers

An extension can add a provider of any of the four kinds. Extend the class `goblin` gives (not one you imported: the registries check `instanceof` against the app's own), declare its statics as the built-in providers do ([CLAUDE.md](../CLAUDE.md#provider-extensibility) lists them: `display`, `parseUrl`, `defaultSettings`, `consent`, `setupWizard`, `linkPlatforms`, `summary`, `settingsRows`…), and register it:

```js
export default function activate(goblin) {
    const key = goblin.providers.keyOf("myserver"); // "my-extension.myserver"

    class MyServerService extends goblin.MetadataService {
        static display = { label: "My server", acronym: "MYSRV", color: "#3b8db2", colorSubtle: "#0a5060", colorBright: "#1da0c3" };
        static summary = "Reads track links of my own music server.";
        static parseUrl(url) {
            const m = /^https:\/\/music\.example\.org\/t\/(\w+)/.exec(url);
            return m ? { platform: key, type: "track", id: m[1] } : null;
        }
        constructor(task, logger) {
            super("MyServerService", task, logger);
        }
        async getTrackMetadata(url) {
            const res = await goblin.fetch(`https://music.example.org/api/track?url=${encodeURIComponent(url)}`);
            const t = await res.json();
            return { id: t.id, trackName: t.title, artists: [{ type: "artist", name: t.artist }], duration: t.ms, isrc: t.isrc,
                url, uri: `${key.toUpperCase()}::TRACK::${t.id}`, platform: key, apiProvider: key, fetchedAt: new Date(), type: "track" };
        }
        async searchTrack() {
            return [];
        }
    }

    goblin.providers.metadata.register("myserver", MyServerService); // also discovery, download, stems
}
```

- The key is prefixed with the extension's name (`my-extension.myserver`). The `platform` of its metadata and of `parseUrl` **must be that full key**: `goblin.providers.keyOf()` gives it.
- It appears in Settings (with its `defaultSettings`), the first-run picker, the columns and the sources, like a built-in provider.
- **When the extension is gone** (off, failed, removed), the tracks that came from it keep all their data: their sources, the user's links and overrides. Its platform is shown as "_key_ (extension _name_ is not loaded)", its sources cannot be fetched again, and nothing is migrated when it comes back.
- An extension loaded later in a run (allowed from the trust question) reaches the tasks added from then on; the tracks already in the list get its providers at the next start.

## Claude

### A tool for the chat

```js
goblin.agent.defineTool({
    name: "find_owned", // the chat sees "library_dedupe__find_owned"
    summary: "Lists the tracks of the list already in the user's library folder.",
    kind: "read", // read | write | confirm
    locks: "none", // none | task (then `taskId` is a required input) | tasks
    input: { type: "object", additionalProperties: false, properties: { folder: { type: "string" } } },
    example: {},
    run: async (input, ctx) => { … return { owned: [...] }; },
});
```

It is checked like the app's own tools (a summary, a kind, a JSON-Schema input, what it locks) and its input is validated before `run`. Its summary tells Claude which extension it comes from.

- **Read the tracks** with `goblin.tasks`. Return data, and keep it small (a result over 30 000 characters is cut). Text from tracks and titles is data other people wrote: return it in fields, never in sentences of your own.
- **Change a track** only through `ctx.write(taskId, revision, label, (editor) => …)`: it goes through the agent's own guard (the turn's budget, a refused stale revision, the lock), and `editor` has the methods of `tasks.edit()`. Take `revision` from Claude's input (it reads it with `get_task`).
- **Anything irreversible or public** is a `confirm` tool that asks first: `await ctx.confirm({ title, message, choices: [safe first, …] })`, and does nothing on `null`.
- `ctx.signal` aborts when the user presses Stop.
- An extension's tool cannot be undone by `/undo`.

### One question to Claude

```js
const answer = await goblin.claude.ask("Which genre is this? Title: …", {
    schema: { type: "object", required: ["genre"], properties: { genre: { type: "string" } } },
    model: "haiku", // default: the Claude provider's
    webSearch: false,
    signal,
});
if (answer === null) return; // the user did not allow the Claude provider
```

It runs the user's own Claude Code CLI with no tools (web search only when asked), behind the same consent as the Claude provider (asked once; `null` when refused or nobody could answer). Its time and notional cost are logged.

## The rules

An extension runs inside the app: the app's rules are its rules.

1. **Change tracks only through `goblin.tasks`** (and `ctx.write` in a tool): never reach for internals. User data (`userSources`, `metadataOverride`, saved files and stems) is never thrown away by them.
2. **Ask before anything irreversible or public** through `goblin.dialog`, safe button first, and read `null` as no.
3. **No synchronous file system calls** in a handler, an `unavailableReason` or `settings.rows` (`fs.promises`, never `readFileSync`): the whole interface waits for them. Ink repaints the screen for every change: never call something that causes a render in a tight loop.
4. **Everything that waits on the outside world has a limit**: `goblin.fetch` and `goblin.spawn` have one, give `signal` to what takes it.
5. **Programs through `goblin.spawn`**, never `child_process` (it would inherit nothing of the clean-up, and could outlive the app).
6. **Never read or write the environment for credentials**: `goblin.secrets`.
7. **Never import the app or Ink**: everything comes through `goblin`. A copy of the app's classes would be refused by the registries, a copy of Ink would draw nothing.
8. **Never `console.log`**: `goblin.log`.
9. **Read providers generically** (by their statics), never by their key.

## Trust, and what the user sees

Node has no real sandbox, and the app does not pretend to have one: **an extension can do anything the app can** (read and change files, use the network, read the credentials). So:

- The first time the app finds an extension, it asks once the interface is up: _Not now_ (asked again at the next start), _Never_ (off until turned on in Settings), _Load it_ (loaded at once).
- The answer is kept in `extensions.json` in the data folder, with a hash of every file of the extension's folder (except `node_modules/`, whose content follows from the lock file, which is hashed). **When a file changes, the question is asked again**: an update is a new decision.
- **Settings → Extensions** lists every extension found: its state (loaded · off · waiting for your answer · its files changed · failed: _reason_ · needs API v2), its switch, its settings, what it adds, its log lines and its folder. Switching one off takes effect at the next start; switching one on asks the question again.
- `--extension <folder>` (or `GOBLIN_EXTENSION`) loads a folder without asking, for its author. It is never recorded, and the log says so at every start. It takes the name over an installed copy for that run.
- A crash report names the loaded extensions; `--no-extensions` is the first thing to try.
- Removing or switching off an extension never loses a track, a source, an override or its settings.

## Installing and sharing

```bash
goblin-malin ext list                                  # what is installed, and whether it is on
goblin-malin ext add ./my-extension                    # copies a folder (without node_modules / .git)
goblin-malin ext add https://github.com/you/my-ext.git # clones it
goblin-malin ext add ./my-extension --force            # replaces an installed one
goblin-malin ext remove my-extension                   # deletes its folder (asks; --yes to skip); its settings stay
goblin-malin ext new my-extension [folder]             # a new one, ready to edit
```

`add` runs `npm install --omit=dev` when the extension's `package.json` has dependencies. Installing never trusts it: the app still asks before its first load.

## TypeScript

The types are published with the app as `goblin-malin/extension-api`:

```bash
npm install --save-dev goblin-malin   # in the extension's folder (the scaffold lists it)
```

In JavaScript, `// @ts-check` and a JSDoc type give completion and checks:

```js
// @ts-check
/** @param {import("goblin-malin/extension-api").GoblinApi} goblin */
export default function activate(goblin) { … }
```

In TypeScript, compile to an ES module and point `entry` at the output:

```ts
import type { GoblinApi } from "goblin-malin/extension-api";
export default function activate(goblin: GoblinApi) { … }
```

Only the **types** come from the package. Never import its code: the values come through `goblin`.

## Versions

`goblin.apiVersion` is **1**. An extension declares the version it was written for in `apiVersion`, and is loaded only by an app with the same one; Settings → Extensions says which side to update otherwise. A change that would break an extension written for the current version (a member removed or renamed, a parameter that became required) bumps it. New members can arrive within a version.

For the app's developers: the public types are [`src/extensions/api/types.ts`](../src/extensions/api/types.ts), and their shape is committed as [`extension-api.snapshot.d.ts`](extension-api.snapshot.d.ts). A unit test fails when they differ: refresh it with `yarn run extension-api --write`, and bump `EXTENSION_API_VERSION` in `src/constants.ts` when the change breaks extensions.
