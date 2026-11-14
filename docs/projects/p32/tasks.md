# P32 — Claude as an Agent Inside the App: Tasks

> **Status: proposed.** Nothing here is built yet. This project is the chat-and-actions half of "Next: Claude as an agent" in [P29](../p29/tasks.md): T29.2 (detect and fix metadata issues) and T29.4 (agent UX) become uses of it. T29.1 (pick the best source) stays in P29: it is a non-interactive pipeline decision, not a chat feature.

## Context

Today Claude is a **fallback inside discovery** ([P29](../p29/tasks.md)): `ClaudeClient` runs `claude -p` in an empty sandbox (`--tools ""`, no MCP, cwd = temp dir), so Claude sees nothing of the app. It does web research of its own while Goblin Malin already has working Spotify / YouTube / MusicBrainz / yt-dlp / Soulseek services.

The goal is a second, separate way to use Claude: a **chat agent** that gets **a set of typed capabilities ("tools") to read and act on the user's tasks**, through the same Claude Code CLI and the user's own plan (no API key). The user talks to it in a **chat panel on the right** of the main screen ("fix the titles of these 12 tracks", "find a source for the ones that have none").

What must hold:

- **Claude never edits a file.** It cannot read or write `sessions.json`; it only calls tools. No shell, no file tools, **no web access in the agent session**.
- **Data being touched is protected.** While Claude works on a task the user cannot edit it, and a write based on an out-of-date read is refused.
- **Batches are possible, and safe.** A batch is planned, shown to the user, then applied.
- **Providers are not hardcoded.** The tools that expose providers are generated from the registries ([CLAUDE.md → Provider extensibility](../../../CLAUDE.md#provider-extensibility)).

Design rules inherited from [P29](../p29/tasks.md) and still binding: **ask first** (own `consent`), **Claude proposes, the app verifies**, **visible** (the `agent` icon, an activity line), **cost-aware** (quota counter, concurrency cap).

## Two Claude sessions, kept apart

| Session            | Tools                                    | Web | Used for                                             |
| ------------------ | ---------------------------------------- | --- | ---------------------------------------------------- |
| Discovery (exists) | none (`--tools ""`), one `--json-schema` | yes | Last-resort discovery in the pipeline. **Unchanged** |
| Chat agent (new)   | only the app's MCP tools                 | no  | Reading and acting on tasks, on the user's request   |

Untrusted text (track titles, descriptions, web pages) plus write tools plus web access in one session is the dangerous combination, so the chat agent never gets web access. Web research stays in the existing sandboxed `ClaudeClient`.

## Architecture

```
 Chat panel (Ink) ──► claude CLI  (user's plan, resumed session)
                        │  allowlist: only the app's tools
                        ▼
            Local MCP server  (127.0.0.1 + per-session token, inside the app process)
                        ▼
       Tool registry  ──►  locks + journal  ──►  named Task / DownloadTask methods
```

- The app process owns the data folder (single-instance lock). Claude goes **through the running app**, never around it.
- **Allowlist, not denylist.** The CLI is started like the existing client (`--tools ""` and `--setting-sources ""`) plus the app's MCP server only (`--mcp-config` + `--strict-mcp-config`) and `--allowedTools` limited to that server's tools. A denylist (`--disallowedTools`) stops covering new built-in tools whenever the CLI adds one. The flags exist in the installed CLI (2.1.302); re-check them on every CLI bump.
- **Windows and secrets.** `claude` is a `.cmd` shim there (`resolveCliCommand` already deals with it) and inline JSON in `--mcp-config` is fragile: pass a **temp file**. The token must not sit on a command line other local processes can read (file or environment), and the server validates the `Host` header.
- **Transcripts.** Resuming a conversation needs `--no-session-persistence` removed, so task data ends up in Claude's own session files. The consent copy says so, and says what is sent (titles, artists, URLs, trimmed logs).
- Tools are **verbs on named task methods**, never a generic `updateAttributes`.

## The tool catalogue (one source of truth)

Every tool is declared **once**, in one registry, with its metadata. The MCP server, the permissions, the confirmation behaviour, the docs and the CLI listing are all read from it. Nothing is hand-copied.

```ts
defineAgentTool({
    name: "select_source",
    summary: "Choose which download source a track will use.",
    kind: "write", // "read" | "write" | "confirm" (always asks the user)
    input: {
        // plain JSON Schema: no new dependency (see T32.1)
        type: "object",
        properties: { taskId: { type: "string" }, sourceUri: { type: "string" }, revision: { type: "number" } },
        required: ["taskId", "sourceUri", "revision"],
    },
    locks: "task", // what it must hold: "none" | "task" | "tasks"
    undoable: true,
    run: async (args, ctx) => {
        /* calls a named DownloadTask method */
    },
});
```

Two ways to see the catalogue, both generated from that registry:

- **`yarn run agent:tools`** prints the table in the terminal (`--md` for markdown, `--json` for scripts, `--kind write` to filter).
- **`docs/agent-tools.md`** is the same table as a committed file, with the input schema and one example per tool. A unit test regenerates it in memory and **fails when the committed file is stale** (`yarn run agent:tools --write` refreshes it).

Details that make this work:

- The script and the test call a dedicated **`registerAgentTools()`**, which `initMusicApp()` also calls. They never call `initMusicApp()` itself: it starts the live-playlist scheduler.
- The generator runs its output through Prettier, and the test compares the formatted text, so the committed file is stable under `prettier --check`.
- Columns: `Tool | Kind | Locks | Undoable | Confirms | Inputs | What it does`. A tool without a `summary`, an input schema or a `kind` does not register (a unit test enforces it).

### Planned tools (first version)

| Tool                                         | Kind    | Locks | Backed by                                                                    |
| -------------------------------------------- | ------- | ----- | ---------------------------------------------------------------------------- |
| `list_tasks(filter, cursor)`                 | read    | none  | the orchestrator's task list (paginated, size-capped)                        |
| `get_task(id)`                               | read    | none  | `Task.get()` snapshot + its `revision`                                       |
| `get_sources(id)`                            | read    | none  | the task's `downloadSources`                                                 |
| `get_logs(id, cursor)`                       | read    | none  | the task logger (paginated, size-capped, user name and home path masked)     |
| `lookup_url(url)`                            | read    | none  | `urlParserRegistry` + the matching metadata service                          |
| `musicbrainz_lookup(query)`                  | read    | none  | the MusicBrainz client of [P30](../p30/tasks.md)                             |
| `set_metadata_override(id, patch, revision)` | write   | task  | a new `DownloadTask.setMetadataOverride` (validates, checks the lock)        |
| `select_source` / `reject_source`            | write   | task  | `selectDownloadSource` / `rejectDownloadSource`, addressed **by source URI** |
| `add_user_source(id, url)`                   | write   | task  | `DownloadTask.addUserSources` (kept in `userSources`, never rebuilt)         |
| `rediscover(id, provider?)`                  | write   | task  | `startSingleProviderDiscovery`, `checkMusicBrainz`                           |
| `plan_batch(...)` / `apply_batch(planId)`    | write   | tasks | T32.4 (the lease is taken by `apply_batch` itself)                           |
| `archive_tasks(ids)`                         | confirm | tasks | the delete bridge's archive path (can be undone)                             |

Not in the first version, see "Deferred": `run_tasks`, `save_tasks`, `delete_tasks`, `search_sources`.

This table is the **plan**; once T32.1 lands, `docs/agent-tools.md` replaces it as the reference.

## Tasks

### T32.1 — Spike (go/no-go), tool registry and the catalogue

**Go/no-go gate, recorded in this file before anything else is built:**

- **Transport:** an in-process HTTP MCP server driven by the user's own CLI (decided; matches the existing "personal use of `claude -p`" choice). The Agent SDK is not used: its use of a subscription is the less clear case.
- **Dependencies:** `zod` is only a transitive dependency (3.25.x via ytmusic-api, 4.x via an ESLint plugin) and ytmusic-api needs zod 3. The spike decides between the MCP SDK (bundle weight, zod) and a **small hand-rolled JSON-RPC server** (`initialize`, `tools/list`, `tools/call`) with plain JSON Schema. Measure the bundle either way.
- **Perf spike for the chat panel**, early because it decides the layout: render a streaming message next to the task list and measure it with the perf suite (see T32.6).

Then:

- `defineAgentTool` + `agentToolRegistry` in `src/base/agent/` (generic, knows nothing about music); the music tools register from `registerAgentTools()`.
- The local MCP server: `127.0.0.1`, random port, random token per session, `Host` header check, closed with the app.
- `yarn run agent:tools`, `docs/agent-tools.md` and the stale-doc test.
- First tools: the read-only ones. Pagination and size caps from the start.

### T32.2 — Safe writes: named methods, locks, revisions, journal

**Prerequisite — put the writes behind named methods.** There are 69 `updateAttributes` call sites, 37 of them inside `downloadTask.ts`. The UI writes with no validation and no lock check (`MetadataPanel.tsx` for `metadataGroups` and `metadataOverride`, `DownloadPanel.tsx` for `metadataOverride`). Before any agent write exists:

- list every UI write to user-owned fields, and move each into a named task method that validates and checks the lock (`setMetadataOverride`, a by-URI variant of `selectDownloadSource`, …);
- make the UI and the agent tools call the **same** methods, so "the same validation as a user edit" is true.

**Locks gate external writers only.** The pipeline is the busiest writer and must not be locked out:

- A lock on the generic `Task` (`src/base/task/`): holder (`user` / `agent`), since when, a TTL. In memory only; cleared at start-up so a crash never leaves a task stuck.
- A task the pipeline is processing **refuses agent writes** ("task is running"); reads stay allowed.
- The UI actions (and `runSelected`) call `isLocked()` before mutating; a locked row is greyed with the `agent` icon.
- **Leases are implicit**: taken by each write tool for the duration of the call, or by the turn; `apply_batch` takes one on the whole set. The model has no `claim` / `release` tool, so a lease cannot leak. Released at the end of the turn, on error and on Stop.

**Revisions cover the user-editable surface only**, not every notify (`notifyTaskSubscribers` fires on every status and progress tick, which would make every write stale during a download):

- the revision changes when overrides, `userSources`, the selected source, rejections or the source list change;
- every read returns it; a write carrying an older one is refused with "the task changed, read it again".

**Journal and undo:**

- Each agent write records before/after for the user-owned fields only (`metadataOverride`, `userSources`, selection, rejections). `metadataGroups` and the discovered sources are rebuilt by the pipeline, so they are never journaled.
- "Undo Claude's last action" is refused when the revision has moved since.
- Hand-entered data keeps its rule: `userSources` is touched only through `addUserSources` / `removeUserSource` (test that restarts the task, like `tests/unit/userSources.test.ts`).

### T32.3 — Write tools and consent

- The write tools of the table above, each calling the named method from T32.2 (nothing Claude says is trusted as data).
- `static consent` for the agent ("Claude can read and change your tasks"), distinct from the discovery consent; off until the user allows it, once. It says what is sent (titles, artists, URLs, trimmed logs) and that Claude's own session files keep the conversation. Settings: enable, model, CLI path (shared with the existing Claude settings).
- `confirm` tools go through `dialogBridge.confirm`, safe button first, and resolve "not done" when dismissed or when no UI is mounted.
- **Mutation budget per task touched**, not per call, so bulk tools do not hit it at once; a cap on parallel agent turns.

### T32.4 — Batches: plan → preview → apply

- `plan_batch` is a dry run: it returns a diff ("37 tasks: title cleaned of `(Official Video)`") and a `planId`, changes nothing.
- The user reviews it in a dialog; `apply_batch(planId)` runs under a lease on the whole set, in the background, abortable, with progress on the rows.
- Bulk tools (`bulk_set_override(filter, patch)`) do the deterministic part in code so a 200-track job does not go through the model 200 times (quota).
- A plan expires when the revision of any of its tasks changes.

### T32.5 — Provider tools for the chat agent

- `lookup_url` and `musicbrainz_lookup` are built from the registries (`urlParserRegistry`, the MusicBrainz client), so a new metadata provider shows up with no change here. They are exposed **to the chat agent only**.
- **`ClaudeDiscoveryService` is left alone**: today it is one `--json-schema` call (about 1.4k tokens), whereas a tool loop costs more turns and quota and would run under the pipeline's own lock holder. Revisit only if the chat agent's tools prove cheaper, with measurements.
- T29.2 (detect and fix metadata issues) is a chat use: Claude reads a task, proposes `set_metadata_override` changes as a reviewable diff, and nothing is applied without the user.

### T32.6 — Chat panel

- A panel on the right of the main screen (about 40 columns), toggled by a rebindable shortcut. `AppInner` puts the task list and the secondary panel in a row next to it.
- **Layout threshold:** derived from `MIN_TERMINAL_WIDTH` (66) plus the panel width (about 106 columns). Below it the chat is a **modal**, reusing the existing modal infrastructure (a bottom panel would eat rows from the 16-row minimum layout). `isTerminalTooSmall` still only decides whether to render at all.
- Input through `TextInput` and `useShortcuts` (never `useInput`); hints through `Hint` / `hintLines`; while focused it claims pasted links with `pasteRouter`.
- Conversation through `--resume <session id>` first (one process per message); a long-lived `--input-format stream-json` process only if start-up cost hurts.
- Streaming (`--output-format stream-json --include-partial-messages`) **batched to 250–500 ms**: Ink repaints the whole screen on every commit, 100 ms would be 10 full frames per second, and Windows repaints on every commit. Add a **perfSuite scenario** for it and keep the numbers in this file.
- Each message carries the current selection ("these 12 tasks", "this one") as a short header.
- Tool calls are shown live (`select_source → Track X`), with a Stop wired to the turn's `AbortSignal`.

### T32.7 — Agent UX, safety and tests

- Activity line per task and a usage counter in Settings (was T29.4).
- Threat model written down: task titles, descriptions and logs are **untrusted text** that may try to instruct Claude. The answers: an allowlist of the app's tools only, **no web in the agent session**, validated inputs, no shell or file tools, confirmation for anything irreversible, a mutation budget per task touched, and the journal.
- Tests: the registry (every tool has a kind, schema and summary), locks and revisions (concurrent user edit vs agent write, a write during a download, restart while locked), undo refused after a revision change, batch expiry, the stale-doc test, a fake `claude` binary for the MCP round trip, and a TUI harness scenario for the chat panel.

## Deferred (not in the first version)

- **`run_tasks` and `save_tasks`**: add later behind one confirmation per batch, once the locks have proven out. Define the handover first: what happens to the agent's lease when `run_tasks` hands a task to the pipeline.
- **`delete_tasks`**: dropped. `archive_tasks` stays, because it can be undone.
- **`search_sources(provider, query)`**: nothing to generate it from today. `DownloadService` only has `downloadTrack`: yt-dlp does not search at all, and Soulseek searches and downloads in one step. It needs an optional generic search capability on download services first, which is its own task, with its own tests.

## Decisions

1. **Transport:** in-process HTTP MCP server with the user's own CLI. Final once the T32.1 spike passes.
2. **Narrow terminals:** a modal.
3. **Autonomy:** the first version prepares and fixes metadata and sources only; it does not start downloads or save files.

## Order

T32.1 (the spike is a go/no-go gate for the transport and the dependency choice, plus an early perf spike for the chat panel) → T32.2 (including the UI-write refactor, before any agent write) → T32.3 → T32.6 → T32.4 → T32.5 → T32.7. The safety and test items of T32.7 are written alongside each step, not left to the end.
