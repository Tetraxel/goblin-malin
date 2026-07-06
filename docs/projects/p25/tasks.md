# P25 — Per-Service Status: Tasks

## Context

**Release blocker**: *"Status per service (Spotify, Ytdlp, etc…) instead of per task"* (TODO.md).

The root cause is one line: `ServiceBase` wires every service to the **same** status object — `this.status = this.task.getStatus()` ([service-base.ts](../../../src/base/service-base.ts):26). When a task runs Spotify fetch, Songlink discovery, MusicBrainz discovery, and a yt-dlp download (some concurrently under the P20 stage limiters), they all write to one `TaskStatus` — the STATUS column shows whichever service wrote last, and a failed provider's error is overwritten by the next provider's progress. The user cannot answer "which provider failed?" or "what is *this* provider doing?" without opening the logs.

The plumbing is favorable: `TaskStatus` ([task-status.ts](../../../src/base/task/task-status.ts)) is already a self-contained observable with the P20 equality-bail and scheduler batching, and every provider already has its own column cell. What's missing is one status instance *per service* and an aggregate for the task level.

---

## Tasks

### T25.1 — Per-service `TaskStatus` on `Task`

- `Task` gains `getServiceStatus(serviceKey: string): TaskStatus` — lazily creates and caches a named instance per key; each flows through the notification scheduler exactly like the main status (dirty-marking per source already coalesces to one commit/frame, so N service statuses add no commit pressure).
- `ServiceBase` constructor takes the service's own status: `this.status = task.getServiceStatus(id)`. **No service code changes** — every `this.status.set/update` call in Spotify/YouTube/Songlink/MusicBrainz/YtDlp lands in the right bucket automatically.
- The task-level `getStatus()` remains, but services stop writing to it (T25.2 derives it).

_Depends on: nothing_

---

### T25.2 — Task-level aggregate status

`Task` derives its headline status from the service statuses + lifecycle:

- Precedence: any `Error` → Error (message: `"<provider label>: <message>"`) · any `Processing` → Processing (message of the most recently active service, min progress across active ones) · any `Pending/Locked` → Pending · else Success/idle.
- Recompute on service-status change, behind the existing equality bail so unchanged aggregates don't notify. Lifecycle transitions (queued/stopped, set by the flow/orchestrator — e.g. `runAll`'s `Queued`) write to the aggregate directly, as today.
- This keeps **every existing consumer** (StatusCell, toolbar busy states, session snapshots) working before any UI work happens.

_Depends on: T25.1_

---

### T25.3 — Snapshots & session revival

- `TaskSnapshot` gains `serviceStatuses?: Record<string, StatusSnapshot>`; `Task.get()` includes it (respecting the `_snapshotCache` invalidation pattern) and the constructor accepts it — so a reopened session (P13) shows *which provider* had failed, not just "Error".
- `reviveTaskDates` untouched (statuses carry no Dates today; if `timeTracking` timestamps serialize, revive them here).

_Depends on: T25.1_

---

### T25.4 — Provider-cell status glyphs

Each provider column cell (metadata, discovery, download) renders its service's live state as a leading glyph: shared-cadence spinner while `Processing` (the P20/F2 single ticker — no new timers), `✓` success, `✗` error, `◌` pending, nothing when idle. Implementation: one small `useServiceStatus(task, serviceKey)` hook (subscribe + snapshot, memo-friendly per P19 conventions) used by all cells — no per-cell subscription code duplicated.

_Depends on: T25.1_

---

### T25.5 — Richer StatusCell + detail surfacing

- `StatusCell` shows the aggregate plus a compact per-stage tally when running, e.g. `Downloading · meta 3/3 ✓ · dl 1/2` (counts from service statuses; acronyms via `providerDisplayRegistry` — nothing hardcoded).
- MetadataPanel group headers and DownloadPanel provider headers show their service's status message inline when `Error` (e.g. `Spotify — rate limited`), with the existing per-provider re-run contextual actions (`startSingleProviderSearch` / `startSingleProviderDiscovery`) as the natural fix path.

_Depends on: T25.2, T25.4_

---

### T25.6 — Tests & perf guard

- Unit: aggregation precedence matrix; equality-bail on unchanged aggregates; snapshot round-trip with service statuses.
- Profiling: extend the download-storm harness scenario to assert commits/s stays within the P18 anomaly budget with per-service statuses active (the point of routing through the scheduler).

_Depends on: T25.1–T25.5_

---

## Summary

| Task  | What                                                       | Depends on   |
| ----- | ----------------------------------------------------------- | ------------ |
| T25.1 | `getServiceStatus()` per key; ServiceBase uses its own      | —            |
| T25.2 | Derived task-level aggregate (keeps all consumers working)  | T25.1        |
| T25.3 | Service statuses in snapshots + session revival             | T25.1        |
| T25.4 | `useServiceStatus` hook + glyphs in provider cells          | T25.1        |
| T25.5 | Tally StatusCell + panel-header error surfacing             | T25.2, T25.4 |
| T25.6 | Aggregation tests + commit-pressure guard                   | T25.1–T25.5  |
