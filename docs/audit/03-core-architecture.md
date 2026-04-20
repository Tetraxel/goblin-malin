# Core Architecture

The `src/base/` layer is a generic framework that has no knowledge of music, Spotify, or yt-dlp. It defines the reusable building blocks that any flow can use.

## ServiceBase (`src/base/service-base.ts`)

All services (both metadata providers and download providers) extend `ServiceBase`. It extends Node's `EventEmitter` and provides:

- **`this.logger`** — a child logger scoped to this service and its parent task
- **`this.env`** — an `Env` instance for retrieving environment variables with interactive prompts
- **`this.status`** — a reference to the parent task's `TaskStatus` (services update task status directly)
- **`runExclusive(actionKey, operation)`** — deduplicates concurrent calls to the same logical operation. If two tasks call `runExclusive('initialize', ...)` at the same time, the second awaits the first's promise rather than starting a new one. The lock map is static, shared across all service instances.

```
ServiceBase
├── MetadataService (abstract) — src/flows/musicDownloadFlow/metadataService.ts
│   ├── SpotifyService
│   └── YoutubeService
└── DownloadService (abstract) — src/flows/musicDownloadFlow/downloadService.ts
    └── YtDlpService
```

## ServiceRegistry & ServiceScope (`src/base/service-registry.ts`, `service-scope.ts`)

`ServiceRegistry<TTask, TService>` stores named factory functions — it does not hold instances:

```typescript
registry.register('spotify', (task, logger) => new SpotifyService(task, logger))
```

`ServiceScope<TTask, TService>` is created from a registry for a specific task. When a service is first accessed via `scope.getService('spotify')`, it instantiates it once and caches it. `scope.getAllServices()` returns all instances in registration order.

This means every task gets its own service instances, and services are only created when a task actually runs.

## Task (`src/base/task/task.ts`)

`Task<TTaskAttributes>` is the unit of work. It holds:

- `id` — unique string identifier (e.g. `"item-0"`)
- `initialInput` — the raw input string (e.g. the URL from `inputs.txt`)
- `attributes` — typed payload specific to the flow (`MusicDownloadTaskAttributes` for MusicDownloadFlow)
- `status` — a `TaskStatus` instance
- `prompt` — a `TaskPrompt` instance for interactive user input
- `subscribers` — a set of callbacks notified on any state change

`setAttributes()` and `updateAttributes()` both call `notifyTaskSubscribers()`, which triggers UI re-renders for all subscribed components.

`start()` and `stop()` throw `"Not implemented"` by default — concrete subclasses must override them.

Public fields tracked by the orchestrator: `running`, `runnedAt`, `finishedAt`, `attempt`, `success`.

## TaskStatus (`src/base/task/task-status.ts`)

Tracks the current operational state of a task with a `StatusType` enum:

- `Default`, `Processing`, `Pending`, `PendingUserAction`, `Locked`, `Skipped`, `Error`, `Success`

Status attributes include `type`, `message`, `progress` (0–100), and optional time tracking. Status has its own subscriber set — when status changes, it notifies both its own subscribers and the parent task's subscribers (via a subscription set up in `Task` constructor).

## FlowBase (`src/base/flow/flow-base.ts`)

Abstract base for flows. Holds a reference to the `FlowOrchestrator`, a logger, an `enabled` flag, and a subscriber set. Concrete flows must implement:

- `importTasks()` — load new tasks from some source
- `runAll()` / `stopAll()` — control task execution
- `getColumns()` — return column definitions for the task table UI
- `getToolbarButtons()` — return toolbar button hook functions
- `getContextualActionBar(task, attrs)` — return context-sensitive keyboard shortcuts

`notifyTaskSubscribers()` in FlowBase re-renders the UI when flow state changes (e.g. `displayMode` switch).

## FlowOrchestrator (`src/base/flow/flow-orchestrator.ts`)

A singleton (`FlowOrchestrator.getInstance()`) that owns the global task queue and all registered flows.

**Flow registration:** `registerFlow(FlowClass, defaultEnabled)` calls `FlowClass.getInstance(...)` and stores the instance. Currently only `MusicDownloadFlow` is registered (done in `App.tsx` on mount).

**Task queue:** A flat `tasks: Task[]` array. `addTasks()` throws if a task with the same ID already exists. Tasks are categorized as:
- Candidates: `!task.running && task.finishedAt == undefined`
- In-progress: `task.running === true`

**`processTasks()`** — the execution loop:

1. Polls until no candidates and no in-progress tasks remain
2. Starts tasks up to `globalMaxConcurrent` (default: **3**) in parallel
3. When at capacity, uses `Promise.race()` to wait for a slot to free
4. Has a 100ms delay per iteration to avoid a tight loop
5. Calls `processTask(task)` which calls `task.start()` and handles success/failure/finally

Note: `MusicDownloadFlow` declares `maxConcurrentTasks = 2` but the orchestrator does not currently read per-flow limits — it only uses `globalMaxConcurrent`.

**Subscribers:** Both flows and UI components subscribe to the orchestrator for task list changes.

## Logger (`src/base/logger/logger.ts`)

The `globalLogger` is a Winston logger with two transports:
- **File transport** — writes JSON logs to `app.log`
- **InkTransport** — a custom Winston transport that pushes log entries to an in-memory array and notifies React subscribers (used by `LogPanel`)

`logger.createChild(metadata)` returns a child logger that always includes a `service` and/or `task` label in every log entry. All services and tasks create child loggers.

`console.log`, `console.error`, and `console.warn` are overridden in `src/index.tsx` to route through `globalLogger`, preventing raw console output from corrupting the terminal UI.

## Env (`src/base/env.ts`)

Wraps `process.env`. `env.getVariable(name)` returns the value if set. If missing, it sets the task to `PendingUserAction` status and opens a `TaskPrompt` that asks the user to type the value. Once provided, the value is appended to `.env` and cached so it is not asked again.
