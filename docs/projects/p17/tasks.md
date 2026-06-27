# P17 — TUI Test Harness

## Goal

There is currently no way to verify the app's behaviour programmatically — neither for regression testing nor for autonomous agent workflows. Every visual assertion requires a human to run `yarn dev` and observe the terminal. This blocks two things:

- **Regression testing.** Layout regressions, focus/navigation bugs, and interaction-level failures only manifest when all components run together; component unit tests cannot catch them.
- **Autonomous optimization loops.** An agent that makes performance changes has no machine-readable signal to verify its fixes. It must ask a human.

This project builds a **PTY-based scenario harness**: a one-shot CLI tool that spawns the app in a real pseudo-terminal, replays a scripted sequence of key presses and text inputs, captures clean text snapshots of the screen at defined checkpoints, and returns a single JSON result. The agent writes a scenario, runs the CLI, reads JSON — no interleaving, no human in the loop.

The harness is then wrapped in **Vitest** integration tests to establish a formal regression suite.

### Design decisions

- **Real PTY, not fake stdout.** Ink's rendering pipeline is TTY-aware — it uses different code paths for cursor movement, color output, and layout when no real PTY is present. `@testing-library/ink` tests components in isolation but cannot catch layout regressions that only appear in the assembled app. The harness uses `node-pty` (ConPTY on Windows) so the app believes it's running in a real terminal.
- **`@xterm/headless` for screen capture.** Ink rewrites individual lines using cursor movements rather than clearing the full screen on each render. Raw PTY output cannot be read as a linear text dump — it is a sequence of cursor moves and partial line rewrites. `@xterm/headless` is a proper VT100 terminal emulator that maintains a screen buffer; reading it after a stable period gives the actual rendered content, just like a human would see it. This also handles ConPTY's extra escape sequences correctly.
- **`stable` as the primary synchronisation primitive.** Rather than `wait: N ms` (which is machine-speed-dependent and fragile in CI), the harness detects quiescence: no new PTY data for a configurable window (default 300 ms). Steps that need to wait for a render use `{ "type": "stable" }`. `wait` steps exist for the rare case of a predictable external delay.
- **One-shot CLI, JSON out.** The CLI returns `{ snapshots, metrics }` to stdout and exits. This is the interface for both agents and Vitest. No REPL, no streaming, no intermediate interaction.
- **Fixed terminal size.** Scenarios declare `cols`/`rows` (default 200 × 50). All runs use the same size, making snapshot strings reproducible across machines.
- **Two snapshot flavours.** Each named snapshot is stored as `{ raw, plain, ansi }`: `raw` is the raw PTY byte stream since the last boundary; `plain` is the stripped text for programmatic assertions; `ansi` preserves ANSI color codes for human visual review.
- **Three screenshot backends.** `screenshot` uses the built-in emulator (fast, approximate). `screenshot-powershell` spawns a real Windows Terminal window and captures it (slow ~3–5s, but pixel-perfect — preferred for visual validation). `screenshot-browser` uses headless Edge + xterm.js (deprecated).
- **Harness code lives under `scripts/tui-test/`.** It is pure dev tooling, never bundled. TypeScript source, run via `tsx`.

---

## Tasks

### T17.1 — Dependencies

**File:** `package.json`

Add to `devDependencies`:

- `node-pty` — PTY spawn and control (uses ConPTY on Windows, openpty on POSIX).
- `@xterm/headless` — Headless VT100/XTerm terminal emulator for screen-buffer capture.
- `vitest` — Test runner for the integration test suite.

Add to `scripts`:

```json
"test:tui": "tsx scripts/tui-test/cli.ts",
"test": "vitest run",
"test:watch": "vitest"
```

Note: `node-pty` is a native addon and requires build tools (`windows-build-tools` or Visual Studio Build Tools on Windows). Its native binary is version-pinned to the current Node.js ABI; if Node.js is upgraded, run `npm rebuild node-pty`.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.2 — Scenario and result types

**File:** `scripts/tui-test/types.ts`

```ts
export type Step =
  | { type: "key"; key: string }
  | { type: "type"; text: string }
  | { type: "wait"; ms: number }
  | { type: "stable"; timeout?: number; quiescenceMs?: number; minBytes?: number }
  | { type: "waitForContent"; text: string; timeout?: number }
  | { type: "assert"; contains: string }
  | { type: "snapshot"; name: string }
  | { type: "screenshot"; name: string }
  | { type: "screenshot-browser"; name: string }
  | { type: "screenshot-powershell"; name: string };

export type Scenario = {
  terminal?: { cols?: number; rows?: number };
  dataDir?: string; // path to GOBLIN_DATA_DIR (relative to project root or absolute)
  steps: Step[];
  env?: Record<string, string>;
};

export type Snapshot = { raw: string; plain: string; ansi: string };

export type HarnessResult = {
  snapshots: Record<string, Snapshot>;
  metrics: Record<string, number | boolean>;
  exitCode: number | null;
};

export type HarnessEvent = /* live events emitted during a run, used by --pretty CLI */
  | { type: "key"; key: string }
  | { type: "stable:start" } | { type: "stable:end"; ms: number; timedOut: boolean }
  | { type: "waitForContent:start"; text: string } | { type: "waitForContent:end"; text: string; ms: number; found: boolean }
  | { type: "assert:pass"; contains: string }
  | { type: "snapshot"; name: string; plain: string; ansi: string }
  | { type: "screenshot"; name: string; path: string }
  | ...;

export type RunOptions = { onEvent?: (event: HarnessEvent) => void };
```

Beyond the original plan: added `waitForContent`, `assert`, and the three `screenshot*` step types; added `minBytes` to `stable`; added `dataDir` to `Scenario`; added `ansi` to `Snapshot`; metrics values are `number | boolean` (booleans mark timeout flags); added `HarnessEvent` and `RunOptions` for the live `--pretty` CLI mode.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.3 — Key name map

**File:** `scripts/tui-test/keyMap.ts`

Maps human-readable key names (as used in scenario JSON) to the ANSI/VT100 byte sequences that `node-pty` expects. Single characters (letters, digits, punctuation) pass through as-is via the fallback.

| Name | Sequence |
|---|---|
| `Enter` / `Return` | `\r` |
| `Escape` / `Esc` | `\x1b` |
| `Tab` | `\t` |
| `Shift+Tab` | `\x1b[Z` |
| `Space` | `" "` |
| `Backspace` | `\x7f` |
| `Delete` / `Del` | `\x1b[3~` |
| `ArrowUp` / `Up` / `↑` | `\x1b[A` |
| `ArrowDown` / `Down` / `↓` | `\x1b[B` |
| `ArrowRight` / `Right` / `→` | `\x1b[C` |
| `ArrowLeft` / `Left` / `←` | `\x1b[D` |
| `Shift+ArrowUp` / `Shift+↑` | `\x1b[1;2A` |
| `Shift+ArrowDown` / `Shift+↓` | `\x1b[1;2B` |
| `Shift+ArrowRight` / `Shift+→` | `\x1b[1;2C` |
| `Shift+ArrowLeft` / `Shift+←` | `\x1b[1;2D` |
| `Ctrl+A` … `Ctrl+V` | `\x01` … `\x16` |
| `Home` / `End` / `PageUp` / `PageDown` | standard sequences |

`resolveKey(name: string): string` — looks up the name; returns the raw string unchanged if not found.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.4 — Terminal emulator wrapper

**File:** `scripts/tui-test/termEmulator.ts`

`TermEmulator` class wrapping `@xterm/headless`:

- `feed(data: string)` — pushes raw PTY bytes through the VT100 parser.
- `flush(): Promise<void>` — waits for any pending xterm writes to settle.
- `readScreen(): string` — reads the current buffer as plain text (trimmed rows joined with `\n`, trailing blank rows stripped).
- `readScreenAnsi(): string` — same but with ANSI color/style codes preserved, for human review and screenshot backends.

The xterm terminal is constructed with the same `cols`/`rows` declared in the scenario.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.5 — PTY runner

**File:** `scripts/tui-test/runner.ts`

`runScenario(scenario: Scenario, options?: RunOptions): Promise<HarnessResult>`

Lifecycle:

1. **Spawn.** `node-pty` spawns `yarn dev` (via the platform shell) with the scenario's `cols`/`rows`, a merged env (`TERM`, `FORCE_COLOR`, `COLORTERM`, and any `scenario.env` keys), and optionally `GOBLIN_DATA_DIR` from `scenario.dataDir`. All PTY data is forwarded to the term emulator.

2. **Quiescence detection.** `waitForStable({ timeout?, quiescenceMs?, minBytes? })` polls until no new data has arrived for `quiescenceMs` (default 300 ms) AND at least `minBytes` (default 1000) have been received total. Returns `true` if timed out, `false` if stable. A timeout does not abort the run — it captures a snapshot and records `stable_N_timed_out: true` in metrics.

3. **Step execution.** Steps run in sequence:
   - `key` → `pty.write(resolveKey(step.key))`
   - `type` → `pty.write(step.text)`
   - `wait` → fixed sleep
   - `stable` → `waitForStable(step)`
   - `waitForContent` → polls `termEmulator.readScreen()` until the text is found or timeout
   - `assert` → checks screen immediately; throws if not found (records snapshot for debugging)
   - `snapshot` → `{ raw, plain, ansi }` captured into results
   - `screenshot` → renders via the built-in emulator → PNG saved to temp dir
   - `screenshot-browser` → renders via headless Edge + xterm.js → PNG (deprecated)
   - `screenshot-powershell` → renders via a real Windows Terminal window → PNG (preferred)

4. **Teardown.** Kills the PTY process after all steps complete (wrapped in try/catch to suppress ConPTY's `AttachConsole` error on Windows). Returns `HarnessResult`.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.6 — CLI entry point

**File:** `scripts/tui-test/cli.ts`

```
tsx scripts/tui-test/cli.ts <scenario.json> [--pretty]
```

- **Default:** writes `HarnessResult` JSON to stdout, exits 0 on success or 1 on error.
- **`--pretty`:** streams live `HarnessEvent`s to stdout as they happen (key presses, stable timings, inline ANSI snapshots), then prints a metrics summary. Intended for interactive debugging.

This is the interface for agents: write a scenario file → run the CLI → parse JSON from stdout.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.7 — Vitest configuration

**File:** `vitest.config.ts`

Configure Vitest to:

- Match `tests/**/*.test.ts`.
- Set a long test timeout (30 s) to accommodate PTY spawn + app startup time.
- Use `node` environment (not jsdom).

The `tests/` directory sits at the repo root. Integration tests import directly from `scripts/tui-test/runner.ts`.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.8 — Smoke integration test

**File:** `tests/e2e/smoke.test.ts`

Validates that the harness itself works end-to-end: spawns the app, waits for it to render, asserts the initial screen contains recognizable content.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.9 — Example scenario file

**File:** `scripts/tui-test/examples/navigate-settings.json`

A worked example scenario that an agent can read and adapt. Uses `cols: 128, rows: 64` and `dataDir: scripts/tui-test/fixtures/empty` for a clean reproducible state. Covers:

- App boot (`stable` + `waitForContent`)
- Opening the settings modal via keyboard navigation
- Navigating within the modal (`ArrowDown`)
- Asserting modal content (`assert`)
- Closing the modal (`Escape`)
- Capturing text snapshots and a `screenshot-powershell` for visual validation

| Status    |
| --------- |
| ✅ Done   |

---

### T17.10 — Screenshot backends

**Files:** `scripts/tui-test/screenshotPowerShell.ts`, `scripts/tui-test/screenshotBrowser.ts`

Not in the original plan. Two additional backends for visual PNG output beyond the built-in emulator:

- **`screenshotPowerShell`** — spawns a hidden PowerShell script inside a new Windows Terminal window, writes ANSI content with absolute cursor positioning, finds the window by title via Win32 `EnumWindows`, crops the WT tab strip via a pixel scan, and saves the result with `CopyFromScreen`. Requires the user to configure a small enough font size in WT Settings → Profiles → Defaults so all rows fit on screen.
- **`screenshotBrowser`** — renders via headless Chromium/Edge using xterm.js. Deprecated in favour of `screenshotPowerShell` on Windows.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.11 — Fixtures and harness config

**Files:** `scripts/tui-test/fixtures/empty/`, `scripts/tui-test/tsconfig.json`

Not in the original plan.

- **`fixtures/empty/`** — blank data directory (`sessions.json`, `settings.json`, `cache/api-cache`) for starting the app in a known clean state via `"dataDir"`.
- **`tsconfig.json`** — TypeScript config scoped to the harness directory so `tsx` resolves types correctly without polluting the main project config.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.12 — Harness documentation

**Files:** `scripts/tui-test/README.md`, `CLAUDE.md`

Not in the original plan. Full reference documentation for the harness in `scripts/tui-test/README.md` (step types, key reference, typical patterns, fixtures). `CLAUDE.md` has a short pointer so agents load it on demand rather than always in context.

| Status    |
| --------- |
| ✅ Done   |

---

### T17.13 — Docs

**Files:** `docs/projects/README.md`, `docs/projects/p17/tasks.md` (this file)

Add the `P17` row to the project index.

| Status    |
| --------- |
| ✅ Done   |

---

## Verification

| Check | Action |
|---|---|
| Types | `yarn type-check` clean (harness + test files) |
| Lint | `yarn lint` clean |
| PTY spawn | `yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json --pretty` — live events stream, metrics printed at end |
| Snapshot readability | `initial` snapshot plain text contains recognizable app content |
| Key navigation | `settings-open` snapshot contains "Settings" modal content; `settings-closed` does not |
| Metrics | All `stable_*_ms` values are positive numbers; timeout steps record `stable_N_timed_out: true` |
| Smoke test | `yarn test` passes — `smoke.test.ts` green |
| Screenshot | `screenshot-powershell` step produces a PNG with all rows visible (requires WT font size small enough in user settings) |
| ConPTY (Windows) | Plain snapshot text is free of raw escape sequences — `@xterm/headless` absorbed them |
