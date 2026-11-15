# P32 — Claude as an Agent Inside the App: Tasks

> **Status: first version built** (see [What was built](#what-was-built) for what differs from the plan below, and what is left). This project is the chat-and-actions half of "Next: Claude as an agent" in [P29](../p29/tasks.md): T29.2 (detect and fix metadata issues) and T29.4 (agent UX) become uses of it. T29.1 (pick the best source) stays in P29: it is a non-interactive pipeline decision, not a chat feature.

The reference for the tools is now [docs/agent-tools.md](../../agent-tools.md) (generated: `yarn run agent:tools`); the table in this file was the plan.

## What was built

Everything in T32.1 – T32.7, as one change. Where the build differs from the plan, or leaves something out:

- **Go/no-go (T32.1): go.** An in-process, hand-rolled MCP server over HTTP (`src/base/agent/mcpServer.ts`, ~200 lines: `initialize`, `ping`, `tools/list`, `tools/call`) driven by the user's own CLI works end to end: a real `claude -p` (haiku, CLI 2.1.302) connected with `--mcp-config` + `--strict-mcp-config`, `--tools ""` and `--allowedTools mcp__goblin__…`, listed the tool and called it. **No new dependency**: the MCP SDK was not used (it would bring zod 4 next to the zod 3 that `ytmusic-api` needs, and the protocol surface is three requests). **The token never touches a command line or a file**: the config file holds `Authorization: Bearer ${GOBLIN_AGENT_TOKEN}` (the CLI expands environment variables in `--mcp-config`, checked) and the child process gets the value in its environment. A **new token per message** (turn), not per session: a finished turn's token opens nothing.
- **Perf spike (T32.1/T32.6), measured with `perf-chat-stream`** (`scripts/tui-test/examples/perf-chat-stream.json`, a synthetic answer of 60 words/s for 10 s into the open chat, 128×50 terminal): streamed text is gathered and shown every 300 ms: **32 React commits and 32 Ink frames (≈294 ms of Ink output) in 10 s**, against ~600 commits if every word were shown. Two things were found by measuring and fixed: a spinner on the "Claude is working" line cost ~47 more commits in 10 s (it is now a static `✻` glyph; the activity text changes instead), and re-wrapping the whole answer on every flush re-rendered every line (lines keep their identity when their text does not change, so only the last one repaints). Opening the chat: 2 commits, ~100 ms of React time (the task list is laid out again at its new width). The profiler's per-component counts for the main screen (`TaskListPanel`, cells) in that scenario are an artefact of its fiber-flag reading: a render counter placed in `UrlCell` showed 63 renders for the whole run, boot included.
- **Tool names that differ from the plan:** a download row is addressed by `sourceId`, not by "source URI" (every Soulseek row of a track has the same track URI; the id is provider + peer + remote file name, see `downloadSourceIds`). `bulk_set_override` is called **`plan_bulk_override`** (it is a dry run, like `plan_batch`) and does its title cleanup with **literal text and a fixed noise pattern, never a pattern from the model**. `plan_batch` and `plan_bulk_override` are `read` tools (they change nothing); `apply_batch` is a **`confirm`** tool (it always shows the plan first). `set_metadata_override` takes `patch` (values) and `clear` (fields to take back) instead of one patch with nulls, so every field has a plain type in the schema.
- **Writes (T32.2):** `setMetadataOverride`, `patchMetadataOverride`, `setMetadataGroups`, `selectDownloadSourceById`, `rejectDownloadSourceById`, `restoreMetadataOverride`, `restoreDownloadFlags` on `DownloadTask`; `addUserSources` / `removeUserSource` / `selectDownloadSource` / `rejectDownloadSource` take `{ actor }` and check the lock. The three UI writes of `metadataOverride` / `metadataGroups` and the four `selectDownloadSource` calls go through them (`runUserEdit` turns a refusal into "false" and a log line). The other `updateAttributes` call sites (the pipeline's own state, MusicBrainz identity actions, `toTag` / `toDownload` toggles) are **not** converted: they do not write what the agent writes, and the revision does not read them. `runSelected` skips a task Claude holds.
- **After review:** a tool's lease is taken on the task's real id (`agentToolRegistry.setTaskIdResolver`, set by `registerAgentTools()`), so an id written without `task:` still keeps the user out; a part run again on a finished track (`partRunning`) counts as running for the agent's writes and for `runSelected`; `/undo` (and `Ctrl+Z` while Claude answers) waits when a task of the entry is held or running, and restores an entry whole or not at all; undoing `add_tasks` keeps a new track the user edited since; `run_download` / `run_task` only join a call of the same message; the session is saved after the chat is stopped; a locked row's glyph is static (a lease can last minutes). Tests: `tests/unit/agentLocksAndUndo.test.ts`.
- **Revisions** are a fingerprint of the user-editable surface (`computeTaskRevision`), not a counter: the same after a restart, and A → B → A gives A back. Progress and status ticks do not change it.
- **Locks** are leases with a 60 s TTL by default (`leaseMs` per tool), taken by the call (`locks: "task"`) or by `apply_batch` / `archive_tasks` for their set; a task being processed refuses agent writes. A locked row shows the agent glyph where the tick goes, on a grey background.
- **Journal (T32.2):** one entry per write, one per batch; `/undo` (or `Ctrl+Z` in the chat) reverts the newest and is refused when a task changed since. In memory, for the launch.
- **Chat panel (T32.6):** `Ctrl+T` (rebindable: `global.chat`, and `chat.toggle` to close) or the toolbar's **Claude** button; docked at the right from 108 columns (`MIN_TERMINAL_WIDTH` 66 + the 42-column panel), a window over the screen below it. `--resume <session id>` per message (the CLI is started with `--session-id` first, and a lost session starts a new one once). Commands: `/undo`, `/new`. Esc stops a running turn (or hands the keyboard back). **Reading:** an answer is Markdown (`components/ChatPanel/markdown.ts`: headings, lists with a hanging indent, quotes, fenced code, rules, bold / italic / `code` / links; styling is SGR attributes inside the text, never a colour, so the theme colour survives a reset); `PgUp` / `PgDn` and `↑` / `↓` scroll, as does the wheel (the chat is not a "clickable window" of the main screen, so it registers a second wheel target for its own window), and while scrolled up the offset grows with what is added below so the text being read does not move. Tables (`tableLayout.ts`) are a box-drawing grid when the columns keep at least 10 columns (or their content, if shorter), otherwise one card per row. **Frame:** the docked panel has a right border only; the task list's right border is the divider, the tab line `[1] Metadata view [2] Download view` stops at the divider like the one below it (`TabBar` `endChar` `┬`) and goes on into the chat's title (`ChatTitleBar`: `✻ Claude · 3 msg`, dimmed when the chat has not the keyboard), the footer line has a `┴` (`Separator` `splitPositions`), the colour is `theme.ui.border`, and the window variant looks like the other modals (`theme.action.primary`, round). **Mouse:** a docked chat is a click-through window (`setClickThroughWindow` in `base/mouse/clickableWindows.ts`): the main screen stays clickable while the chat has the keyboard, and a click there moves the keyboard to it; the window variant stays modal. `Ctrl+C` (`chat.copy`) copies Claude's last answer as written. **Typing:** `ChatInput` (a second text field next to `ink-text-input`, which cannot wrap) wraps the line over up to 4 rows by word and keeps the cursor in view (`inputLayout.ts`). **Width:** drag the panel's left edge or `Shift+←` / `Shift+→` (`chat.widen` / `chat.narrow`); kept in `agent.panelWidth`, between 30 columns and what leaves the task list its 66. Each message carries the selection ("these 12 tasks") as a short header; the ids are quoted whole (`["task:3d6da40a5c5c"]`) because a model read `task: task:3d6…` as a label and dropped the prefix, and the tools also accept an id without `task:`. **Tool lines:** each keeps what Claude sent and what the tool answered (`ChatMessage.detail`, cut at 8000 characters; the stream's `tool_result` content is carried by the `tool-result` event), shown under it when opened (`▸` / `▾`; `Ctrl+O` for all, a click on one; at most 1500 characters on screen). **Model:** `Ctrl+L` or the "Model" line of the empty chat (`chooseAgentModel`) saves `agent.model`; refused once a message was sent (Claude Code keeps one model per session), the title shows it. **Last conversation:** saved after each answer to `agent-chat.json` (`chatHistory.ts`, the newest 200 messages, written through a temp file) once the CLI knows the session; the empty chat offers "↺ Reopen the last conversation" (`Ctrl+R`, `AgentChat.reopenLast`, which restores the messages and resumes the session). Never automatic: resuming costs the user's plan. `/new` goes back to the empty chat (no "New conversation" note any more). **Look:** what the user wrote sits on a band (`theme.ui.rowBackground.regular.activeDimmed`) with a blank row above and below; a chip "● N tasks selected" with the track's name sits above the text line; blank rows separate the conversation, the status, the text line and the hints; the content has 2 columns of padding on the left. **Starting tasks:** `run_metadata` (write: a never-run track goes through `runSelected` with TAG? on and DL? off; a run one calls `DownloadTask.runMetadataPart`, which keeps overrides and links), `run_download` (confirm: `runDownloadPart`, only for a track with `metadataDiscovered` or `downloadsFetched`) and `run_task` (confirm: a never-run track, flags on, `runSelected`). Each takes up to 20 tracks, refuses an album/playlist, a track being processed or locked by someone else, answers at once (the work goes on in the background) and tells Claude to look with `get_task` rather than poll. A run track is never restarted by Claude (`restart()` and `runSelected` on a finished track reset the overrides). The first answer to a download asks with the safe button first; the third choice keeps the permission for the conversation (`agent/runAllowance.ts`, reset by `/new` and by reopening). Claude never saves to the music folder. **Timeouts and repeated questions:** the Claude CLI cuts an MCP tool call at 60 s (seen in `agent.log`: `"The operation timed out."` at exactly 60015 ms), so a dialog nobody answered in a minute, or `wait_for_tasks`, made the model call again. The CLI is started with `MCP_TOOL_TIMEOUT` = 9 minutes (`MCP_TOOL_TIMEOUT_MS`, under the 10 minutes of the whole run). `run_download` / `run_task` also join a call with the same tool and tracks that is still being answered (`joinSameCall`), look again at what can still be started after the answer (a track another run started meanwhile is left alone), and start nothing when the turn ended while the question was open. **Waiting and checking:** `wait_for_tasks` (read; polls, so it needs no callback; 5–240 s, default 120, ends on Stop and says `interrupted`; the activity line shows "Waiting for tasks: 2 of 5 done"), with a verdict per track from `assessTask` (failed run, no source downloaded, download length more than 10 s away from the track's, missing file, title noise, MusicBrainz needs review; a lossy best download is a note, not a problem). No push/callback: a callback would run a model turn per event on the user's plan, unasked. The prompt keeps the retries to one per track, and the review before a download to when the user asks or the link is risky (an upload by a channel): `review_metadata` flags `artists_differ`, `durations_differ`, `title_noise`, `no_isrc`…; accents and punctuation do not make two spellings of an artist differ. `get_settings` shows the effective settings (`SECRET_KEY` values hidden, home folder masked, the list's column widths left out). **agent.log:** `agent/agentLog.ts`, JSON lines (`user` with the prompt, `turn-start`, `session`, `assistant`, `tool-call`, `tool-result` with its duration and uncut output, `result` with the cost, `note`, `error`, `turn-end`), written through a queue (never blocks, never throws), `agent.keepLog` to switch it off. **Tools added after the first version:** `search_music` (free text on every enabled metadata service with `searchTracks`; read) and `add_tasks` (up to 50 links, as pasted into the app, not started; a write that `/undo` reverts for the tasks nobody has started).
- **Consent (T32.3):** `AGENT_CONSENT` (own dialog, "Don't allow" first), stored as `agent.enabled` / `agent.consentAsked` in the music settings; Settings → _Claude agent (chat)_ has the switch, the model and a usage line ("N messages, M model turns, about $X at list price"). The CLI path is the one of the Claude discovery provider.
- **Budgets (T32.3):** 8 changes per task and 500 tasks per turn (`MAX_MUTATIONS_PER_TASK`, `MAX_TASKS_TOUCHED`); one turn at a time (`MAX_PARALLEL_TURNS`). Quota failures share the cooldown of `ClaudeClient`.
- **Not done:** the activity line _per task_ beyond the locked-row glyph (the chat shows the live tool line and a progress line for batches); a per-task "what Claude did" history (the journal is only reachable through `/undo`); `ClaudeDiscoveryService` is untouched, as planned. The deferred tools (`run_tasks`, `save_tasks`, `delete_tasks`, `search_sources`) are not there and a test keeps it that way.

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
3. **Autonomy:** the first version prepares and fixes metadata and sources only; it does not start downloads or save files. (Later: it can start tasks, and a download asks first; see "Starting tasks" under "What was built". It still never saves to the music folder.)

## Order

T32.1 (the spike is a go/no-go gate for the transport and the dependency choice, plus an early perf spike for the chat panel) → T32.2 (including the UI-write refactor, before any agent write) → T32.3 → T32.6 → T32.4 → T32.5 → T32.7. The safety and test items of T32.7 are written alongside each step, not left to the end.
