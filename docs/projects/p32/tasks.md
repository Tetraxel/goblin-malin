# P32 — Claude as an Agent Inside the App: Tasks

> **Status: proposed.** Nothing here is built yet. This project is the "Next: Claude as an agent" part of [P29](../p29/tasks.md), reworked as one generic mechanism instead of one feature per use case (T29.1, T29.2 and T29.4 become uses of it).

## Context

Today Claude is a **fallback inside discovery** ([P29](../p29/tasks.md)): `ClaudeClient` runs `claude -p` in an empty sandbox (`--tools ""`, no MCP, cwd = temp dir), so Claude sees nothing of the app. It does web research of its own while Goblin Malin already has working Spotify / YouTube / MusicBrainz / yt-dlp / Soulseek services.

The goal is the opposite shape: Claude gets **a set of typed capabilities ("tools") to read and act on the user's tasks**, through the same Claude Code CLI and the user's own plan (no API key), and the user can talk to it in a **chat panel on the right** of the main screen ("fix the titles of these 12 tracks", "find a source for the ones that have none").

What must hold:

- **Claude never edits a file.** It cannot read or write `sessions.json`; it only calls tools. No shell, no file tools.
- **Data being touched is locked.** While Claude works on a task, the user and the pipeline cannot change it, and Claude cannot change a task that moved under it.
- **Batches are possible, and safe.** A batch is planned, shown to the user, then applied.
- **Providers are not hardcoded.** The tools that expose providers are generated from the registries ([CLAUDE.md → Provider extensibility](../../../CLAUDE.md#provider-extensibility)).

Design rules inherited from [P29](../p29/tasks.md) and still binding: **ask first** (own `consent`), **Claude proposes, the app verifies**, **visible** (the `agent` icon, an activity line), **last resort for cost** (quota counter, concurrency cap).

## Architecture

```
 Chat panel (Ink) ──► claude CLI  (user's plan, resumed session)
                        │  only the app's tools are allowed
                        ▼
            Local MCP server  (127.0.0.1 + per-session token, inside the app process)
                        ▼
       Tool registry  ──►  locks + journal  ──►  Task / DownloadTask methods
```

- The app process owns the data folder (single-instance lock). Claude goes **through the running app**, never around it.
- The CLI is started with only the app's MCP server (`--mcp-config` + `--strict-mcp-config`) and with the built-in file/shell tools denied (`--disallowedTools`). Check every flag name against the installed CLI version before building (the existing client was measured against claude 2.1.x).
- Tools are **verbs on the existing task methods** (`selectDownloadSource`, `rejectDownloadSource`, `addUserSources`, `startSingleProviderDiscovery`, `checkMusicBrainz`, `runSelected`, …), never a generic `updateAttributes`.
- Transport alternative to settle in T32.1: the Agent SDK with an in-process MCP server (check that its use of the subscription is allowed before choosing it).

## The tool catalogue (one source of truth)

Every tool is declared **once**, in one registry, with its metadata. Everything below is read from it: the MCP server, the permissions, the confirmation behaviour, the docs and the CLI listing. Nothing is hand-copied.

```ts
defineAgentTool({
    name: "select_source",
    summary: "Choose which download source a track will use.",
    kind: "write", // "read" | "write" | "confirm" (always asks the user)
    input: z.object({ taskId: z.string(), sourceIndex: z.number(), revision: z.number() }),
    locks: "task", // what it must hold: "none" | "task" | "tasks"
    undoable: true,
    run: async (args, ctx) => {
        /* calls DownloadTask.selectDownloadSource */
    },
});
```

Two ways to see the catalogue, both generated from that registry:

- **`yarn run agent:tools`** — prints the table in the terminal (`--md` for markdown, `--json` for scripts, `--kind write` to filter).
- **`docs/agent-tools.md`** — the same table as a committed file, with the input schema and one example per tool. A unit test regenerates it in memory and **fails when the committed file is stale**, so the document cannot drift from the code (`yarn run agent:tools --write` refreshes it).

Columns: `Tool | Kind | Locks | Undoable | Confirms | Inputs | What it does`. A tool without a `summary`, an input schema or a `kind` does not compile.

### Planned tools

| Tool                               | Kind    | Locks | Backed by                                                            |
| ---------------------------------- | ------- | ----- | -------------------------------------------------------------------- |
| `list_tasks(filter)`               | read    | none  | the orchestrator's task list                                         |
| `get_task(id)`                     | read    | none  | `Task.get()` snapshot + its `revision`                               |
| `get_sources(id)`                  | read    | none  | the task's `downloadSources`                                         |
| `get_logs(id)`                     | read    | none  | the task logger                                                      |
| `lookup_url(url)`                  | read    | none  | `urlParserRegistry` + the matching metadata service                  |
| `search_sources(provider, query)`  | read    | none  | `downloadServiceRegistry` (generated per registered service)         |
| `musicbrainz_lookup(query)`        | read    | none  | the MusicBrainz client of [P30](../p30/tasks.md)                     |
| `claim_tasks(ids)` / `release`     | write   | tasks | the lock manager (T32.2)                                             |
| `set_metadata_override(id, patch)` | write   | task  | `metadataOverride`, same validation as a user edit                   |
| `select_source` / `reject_source`  | write   | task  | `DownloadTask.selectDownloadSource` / `rejectDownloadSource`         |
| `add_user_source(id, url)`         | write   | task  | `DownloadTask.addUserSources` (kept in `userSources`, never rebuilt) |
| `rediscover(id, provider?)`        | write   | task  | `startSingleProviderDiscovery`, `checkMusicBrainz`                   |
| `plan_batch(...)` / `apply_batch`  | write   | tasks | T32.4                                                                |
| `run_tasks(ids)`                   | confirm | tasks | `runSelected`                                                        |
| `save_tasks(ids)`                  | confirm | tasks | `DownloadTask.saveTrack`                                             |
| `archive_tasks` / `delete_tasks`   | confirm | tasks | the delete bridge                                                    |

This table is the **plan**; once T32.1 lands, `docs/agent-tools.md` replaces it as the reference.

## Tasks

### T32.1 — Tool registry, MCP server and the catalogue

- `defineAgentTool` + `agentToolRegistry` (in `src/base/agent/`, generic — it knows nothing about music; the music tools register from `initMusicApp()` like a provider).
- Local MCP server inside the app process: bound to `127.0.0.1`, random port, random token per session, closed with the app. Rejects any call without the token.
- `yarn run agent:tools` (`scripts/agent-tools.ts`, `--md` / `--json` / `--kind` / `--write`) and `docs/agent-tools.md`, plus the "stale doc" unit test described above.
- Settle the transport (HTTP MCP in-process vs Agent SDK) with a spike; record the decision here.
- First tools: the read-only ones (`list_tasks`, `get_task`, `get_sources`, `get_logs`).

### T32.2 — Locks, revisions and the journal

- A lock on the generic `Task` (`src/base/task/`): who holds it (`user` / `pipeline` / `agent`), since when, a TTL. In memory only; cleared at start-up so a crash never leaves a task stuck.
- **Lease** (`claim_tasks`): for a multi-step job Claude reserves the tasks; they are shown with the `agent` icon and refuse user edits. Released at the end of the turn, on error, and on Stop.
- **Revision** (optimistic check): every read returns a `revision`; a write carrying an older one is refused with "the task changed, read it again". This covers the gap between Claude reading and writing.
- UI actions and `runSelected` ask `isLocked()` before mutating; a task that is downloading is refused (or queued) as a target. Today they call `updateAttributes` directly, so this is the invasive part: list every such call site first.
- **Journal**: each agent write records before/after; a "undo Claude's last action" action. Hand-entered data keeps its rule: it lives in `userSources` and is touched only through `addUserSources` / `removeUserSource` (test that restarts the task, like `tests/unit/userSources.test.ts`).

### T32.3 — Write tools and consent

- The reversible write tools of the table above, each reusing the validation of the matching user action (nothing Claude says is trusted as data).
- `static consent` for the agent ("Claude can change your tasks"), distinct from the discovery consent; off until the user allows it, once. Settings: enable, model, CLI path (shared with the existing Claude settings).
- Tools of kind `confirm` go through `dialogBridge.confirm`, safe button first, and resolve "not done" when dismissed or when no UI is mounted.
- Per-turn budget (maximum number of writes) and a cap on parallel agent turns.

### T32.4 — Batches: plan → preview → apply

- `plan_batch` is a dry run: it returns a diff ("37 tasks: title cleaned of "(Official Video)"") and a `planId`, changes nothing.
- The user reviews it in a dialog; `apply_batch(planId)` runs under a lease on the whole set, in the background, abortable, with progress on the rows.
- Bulk tools (`bulk_set_override(filter, patch)`) do the deterministic part in code so a 200-track job does not go through the model 200 times (quota).
- A plan expires when any of its tasks' revisions changes.

### T32.5 — Providers as tools (replaces the discovery fallback)

- `lookup_url`, `search_sources` and the MusicBrainz lookup are built **from the registries**, so a new provider shows up as a tool with no change here.
- Rework `ClaudeDiscoveryService` on top of them: Claude uses the app's own APIs first and the web only for what they cannot answer; results still pass the platform's own fetch and the confidence gate. Absorbs T29.1 (pick the best source) and T29.2 (detect metadata issues, shown as a reviewable diff, never auto-applied).

### T32.6 — Chat panel

- A panel on the right of the main screen (about 40 columns), toggled by a rebindable shortcut. `AppInner` puts the task list and the secondary panel in a row next to it; under a width threshold the chat becomes a modal (adapt `isTerminalTooSmall`).
- Input through `TextInput` and `useShortcuts` (never `useInput`); hints through `Hint` / `hintLines`; while focused it claims pasted links with `pasteRouter`.
- Conversation through `--resume <session id>` first (one process per message); a long-lived `--input-format stream-json` process only if start-up cost hurts.
- Streaming (`--output-format stream-json --include-partial-messages`) **batched to about one repaint per 100 ms** — Ink repaints the whole screen on every commit ([performance rules](../../../CLAUDE.md#performance-rules)). Profile it with the TUI harness.
- Each message carries the current selection ("these 12 tasks", "this one") as a short header.
- Tool calls are shown live ("select*source → \_Track X*"), with a Stop button wired to the turn's `AbortSignal`.

### T32.7 — Agent UX, safety and tests

- Activity line per task and a usage counter in Settings (was T29.4).
- Threat model written down: task titles, descriptions and web pages are **untrusted text** that may try to instruct Claude; the answer is typed tools, validated inputs, no shell or file tools, mandatory confirmation for destructive tools, a mutation budget per turn, and the journal.
- Tests: the registry (every tool has a kind, schema and summary), locks and revisions (concurrent user edit vs agent write, restart while locked), batch expiry, the stale-doc test, a fake `claude` binary for the MCP round trip, and a TUI harness scenario for the chat panel.

## Open decisions

1. **Transport:** in-process HTTP MCP server (recommended) or the Agent SDK with an in-process server.
2. **Chat placement on narrow terminals:** modal or bottom panel.
3. **Autonomy:** may the agent start downloads (`run_tasks`, `save_tasks`), or only prepare and fix metadata and sources? The table above assumes "yes, after a confirmation".

## Order

T32.1 (read-only, zero risk, validates the transport and the catalogue) → T32.2 (locks, before any write) → T32.3 → T32.6 (chat, usable as soon as there are tools) → T32.4 → T32.5 → T32.7 (the safety and test pass finishes each step, not only the last one).
