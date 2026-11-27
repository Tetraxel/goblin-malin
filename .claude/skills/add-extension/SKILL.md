---
name: add-extension
description: Write a Goblin Malin extension (a folder of JavaScript loaded at start-up that adds Actions items, reacts to saved tracks, adds Claude tools or providers) for a user, from a description of what they want. Use when the user asks for a behaviour too specific for the app itself ("remove tracks I already own", "run beets after each save", "a provider for my server"), or asks to write, fix or extend an extension.
argument-hint: "<what the extension should do>"
---

Write a Goblin Malin extension that does: `$ARGUMENTS`.

An extension is **not** a change to the app: it is a folder the user installs, using only the `goblin` object the app hands to it. Read [docs/extensions.md](../../../docs/extensions.md) first (the whole guide: every member, with examples), then the public types in [src/extensions/api/types.ts](../../../src/extensions/api/types.ts). The two samples in [examples/extensions/](../../../examples/extensions/) are the shape to copy: `library-dedupe` (an Actions item, a dialog with a loader, a scan, a Claude tool, pure matching code in its own file) and `after-save-command` (a `track.saved` handler running a program).

If the request cannot be done with `goblin` (it needs a custom UI component, a pipeline transform, a change to how every track is saved), say so and say what is possible instead; do not reach into the app's internals, and do not change the app unless the user asks for that.

## 1. Decide

1. **Where does it start?** An Actions item (the user runs it on the whole list), an event (`track.saved`, `track.failed`, `collection.done`, `stems.saved`, `tasks.added`, `app.ready`, `app.exit`), a Claude tool (the user asks in the chat), or a provider (a platform, a discovery or download source, a stem separator).
2. **What does it need from the user?** Settings in the manifest (`checkbox`, `textInput`, `select`) for what is chosen once; `goblin.dialog` for what is asked each time; `goblin.secrets` for a key.
3. **Is anything irreversible or public?** Then it asks first (`goblin.dialog.confirm`, safe button first; `goblin.tasks.remove` asks by itself), and reads `null` as no.

## 2. Write it

```
<name>/
  extension.json     { name, displayName, version, apiVersion: 1, entry: "index.js", description, settings }
  package.json       { "type": "module", "private": true }
  index.js           // @ts-check + export default function activate(goblin) { … }
  <pure>.js          the logic that needs no goblin (matching, building a command), so it can be tested
  README.md          what it does, its settings, how to install it
```

`goblin-malin ext new <name> [folder]` writes this skeleton. Keep to the rules of the guide ("The rules"): tracks only through `goblin.tasks` (or `ctx.write` in a tool), programs through `goblin.spawn`, `goblin.fetch` with a timeout, no synchronous file system call in a handler, `goblin.log` (never `console.log`), every registered id local (the app prefixes it). A provider's `platform` is `goblin.providers.keyOf(localKey)`.

## 3. Check it

- Syntax and types: `npx tsc --allowJs --checkJs --noEmit --module nodenext --target es2022 index.js` with `goblin-malin` installed in the folder (or from this repository: point `import("goblin-malin/extension-api")` at `src/extensions/api/types.ts`).
- Load it in the real app: `yarn run dev --extension <folder>` from this repository, or `goblin-malin --extension <folder>`. Settings → Extensions shows its state and its log lines; `app.log` has every line prefixed with `ext:<name>`.
- To look at the screen from a script, use the TUI harness (`scripts/tui-test/README.md`): `GOBLIN_EXTENSION=<folder>` in a scenario's `env` loads it the same way (see `scripts/tui-test/examples/extensions.json`).
- Test its pure file with a few cases (as `tests/unit/extensionSamples.test.ts` does for the samples) when it lives in this repository.

## 4. Hand it over

Tell the user how to install it (`goblin-malin ext add <folder | git URL>`), that the app will ask before loading it (and again after any change of its files), what it adds (Actions item, settings, tool) and how to turn it off (Settings → Extensions, or `--no-extensions`).
