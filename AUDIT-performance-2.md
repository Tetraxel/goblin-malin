# Goblin Malin — performance audit, part 2

|                   |                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**          | 2026-11-13                                                                                                                                                                                                                                                                                                                                                     |
| **Audited**       | `main` @ `d5098e1` (after the fixes of [AUDIT-performance.md](AUDIT-performance.md))                                                                                                                                                                                                                                                                           |
| **Question**      | The app still often feels laggy. Where does the time of a keystroke actually go, in the build users run?                                                                                                                                                                                                                                                       |
| **Method**        | A new end-to-end latency tool ([`scripts/tui-test/bench/latency.ts`](scripts/tui-test/bench/latency.ts), added with this audit) driving the **production bundle** (`node dist/cli.js`) through a PTY; `node --cpu-prof` of that bundle; temporary instrumentation and prototype patches of `node_modules/ink` (all reverted); the existing `perf-*` scenarios. |
| **Where**         | Linux cloud container, 4 cores, Node 22.23. No Windows Terminal / ConPTY (see [section 5](#5-coverage--limits)).                                                                                                                                                                                                                                               |
| **Unlike part 1** | Part 1 measured the development build through the React profiler. This part measures what users run. The two disagree on where the time goes ([TOOL2-01](#tool2-01)).                                                                                                                                                                                          |

Legend — **Severity**: `high` felt on every keystroke · `medium` felt in a common case or on some setups · `low` measurable waste · `info` context. **Confidence**: `measured` reproduced with numbers below · `prototyped` a fix was tried and measured · `verified` proven from the code · `likely` not measured.

---

## 0. Implementation status

Done on the branch of this audit's pull request. **Before** = the base commit with stock Ink (`d5098e1` + `latency.ts`); **after** = the branch tip. Same machine (Linux container, 4 cores, Node 22.23), back to back, 2,000 tasks, truecolor, `perfSuite.ts` (`--runs 3` for the latency rows of "before", 2 elsewhere; medians). The numbers of this machine are lower than the ones above (a faster run of the same code), so compare rows, not absolute values with section 1.

| Finding                                          | State                        | What was done                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PERF2-01](#perf2-01) Ink re-tokenises the frame | **done**                     | `patches/ink/output.js` (cross-frame caches, row cache, shared blank cell), applied by `scripts/apply-ink-patch.mjs` (`prepare`) and **bundled into `dist`** (`noExternal: ink, ink-select-input, ink-text-input`; the build fails if the patch is not applied). Test: `tests/unit/inkOutputPatch.test.ts` (random frames, stock vs patched, byte for byte). |
| [PERF2-02](#perf2-02) two frames per key         | **done**                     | `useDebouncedValue(..., { leading: true })` in `SecondaryPanel`; unit tests; `tests/e2e/perf.test.ts` asserts the bytes of an isolated key (fails with the old debounce).                                                                                                                                                                                    |
| [PERF2-03](#perf2-03) whole screen rewritten     | **done as a setting**        | Settings → General → _Reduce terminal output_ (Ink `incrementalRendering`, read at start-up), **default on for Windows, off elsewhere**: not measured on Windows, as the audit asked. Screens compared cell by cell with the standard mode over 22 keys incl. resize and modals: identical.                                                                  |
| [PERF2-04](#perf2-04) select all / view switch   | **met by PERF2-01, no code** | First byte 66 → 38 ms and 56 → 31 ms. A profile of `Ctrl+A`/`Esc` after the patch is flat (no function above 4 %), so nothing else was changed.                                                                                                                                                                                                              |
| [PERF2-05](#perf2-05) animation frames           | **met by PERF2-01, no code** | `perf-load-tasks`, 12 s of load: 4,415 → 1,498 ms of CPU, i.e. ~37 % → ~12.5 % of a core (target ≤ 15 %).                                                                                                                                                                                                                                                    |
| [PERF2-06](#perf2-06) start-up                   | **partly**                   | `ytmusic-api` (~90 ms) loads on first use. `clipboardy` (~50 ms) is used synchronously from click handlers in six places and was left. Boot to first stable screen is 10–14 % lower (mostly the bundle).                                                                                                                                                     |
| [PERF2-07](#perf2-07) what is left               | **partly**                   | Text widths (`widest-line`, 9 % of busy CPU after PERF2-01) are memoised across frames through the patched `render-node-to-output.js`. The rest (blank grid, Yoga) is small and flat.                                                                                                                                                                        |
| [TOOL2-01](#tool2-01) profiler                   | **done**                     | The fiber walk follows DevTools (descend only when `child !== alternate.child`; mounts only in new subtrees): render counts of the scenarios fell by 2–30× (`Uri` 903 → 106), `profile-navigate` baseline regenerated. Frames now carry `layoutMs`, `writeMs`, `bytes`. `profile.build: "production"` added.                                                 |
| [TOOL2-02](#tool2-02) 16 colours                 | **done**                     | The runner defaults to `FORCE_COLOR=3`; a scenario `env` overrides it (it used to be overridden _by_ the runner).                                                                                                                                                                                                                                            |
| [TOOL2-03](#tool2-03) nothing measures latency   | **done**                     | `perfSuite.ts` runs four `latency.ts` configurations, `perfCompare.ts` prints them, `--latency-cmd` times another build; the e2e test above is the CI gate.                                                                                                                                                                                                  |

### Key latency, built bundle, 2,000 tasks (p50 of the keys)

| Keys                     | First byte, before → after | Screen settled, before → after | Bytes per key, before → after | Held-key backlog |
| ------------------------ | -------------------------: | -----------------------------: | ----------------------------: | ---------------: |
| `↓`, 128×50              |             33.8 → 18.0 ms |                144.5 → 18.2 ms |                41.7 → 20.9 KB |       85 → 72 ms |
| `↓`, 200×60              |             47.0 → 18.9 ms |                170.1 → 19.6 ms |                59.3 → 29.7 KB |      166 → 69 ms |
| `Ctrl+A` / `Esc`, 200×60 |             66.2 → 38.2 ms |                 66.6 → 38.7 ms |                30.2 → 30.2 KB |                – |
| `2` / `1`, 200×60        |             55.6 → 31.4 ms |                 55.7 → 32.0 ms |                29.4 → 29.4 KB |                – |

With _Reduce terminal output_ on (the Windows default), `↓` at 200×60 is 15.3 KB per key (measured separately, settled 23 ms).

### Targets of section 4

| Metric                                 |     Before |  Target | After                                            |
| -------------------------------------- | ---------: | ------: | ------------------------------------------------ |
| Full frames (written) per isolated `↓` |          2 |       1 | **1** (e2e test)                                 |
| Bytes per isolated `↓`, 200×60         |    59.3 KB | ≤ 16 KB | 29.7 KB; **15.3 KB** with Reduce terminal output |
| `↓` settled p50, 200×60                |     170 ms | ≤ 40 ms | **19.6 ms** (p95 ≈ 22–30 ms)                     |
| Backlog after a held key, 200×60       |     166 ms | ≤ 80 ms | **69 ms**                                        |
| `Ctrl+A` / `Esc` first byte p50        |      66 ms | ≤ 40 ms | **38 ms** (borderline)                           |
| CPU while a run animates (dev, 128×50) | ~37 % core |  ≤ 15 % | **~12.5 %**                                      |

### Dev-profile scenarios (`perfSuite.ts`, medians of 2)

Ink's output stage (`inkMs`, which the dev profiler can see) fell 55–80 % in every scenario, process CPU 5–58 % (`perf-load-tasks` 8.6 → 3.6 s, `perf-sessions-heavy` 6.2 → 3.3 s), peak heap 5–42 % (fewer allocations per frame). `reactMs` is 2–14 % _higher_: the lower panel now renders in the same commit as the cursor instead of in a second one, so its React work moves, it does not grow. `inkFrames` rose in the scroll scenarios for the same reason it is not a paint count: a key now causes two `onRender` calls (the second, after an effect-driven re-registration of shortcuts, produces identical output and writes nothing); `bytes` is the number to read, and it is the one the e2e test gates.

### Not done / open

- **Windows** (ConPTY, Windows Terminal) is still not measured: the _Reduce terminal output_ default and the byte savings are to be confirmed there.
- The second, output-less commit per key (shortcut registration effects, `ShortcutDispatcher`/`InputRouter`/`ToolbarButtonInvoker` state) costs ~5 ms of React + Ink per key for nothing; it is outside this audit's findings.
- Open the same Ink change upstream: **not done** (out of scope for this PR).
- `clipboardy` lazy loading, and `measureText`'s own `widest-line` call (12 ms of 2.9 s).

---

## 1. Summary

**In the production build, React is not the problem: Ink's output stage is.** While scrolling the task list, 75–83 % of the app's CPU goes to turning the React tree into terminal text (`ink/build/output.js` and `@alcalzone/ansi-tokenize`). React and the reconciler are about 2–5 %, the app's own code about 1–3 %. Ink rebuilds every character of the screen on every frame and caches nothing from one frame to the next, so a frame costs the same whatever changed: **~46 ms at 200×60**, more on a larger terminal.

On top of that, **one press of `↓` paints two full frames**: the task cursor first, then, 80 ms later (a trailing debounce), the lower panel. So the panel appears ~130–270 ms after the key, and each key costs twice the CPU and twice the bytes.

Both are fixable without touching the UI, and both were prototyped here with byte-identical output:

| Terminal | Build state                                      | First byte p50 | Screen settled p50 | Bytes per `↓` | Held-key backlog |
| -------- | ------------------------------------------------ | -------------: | -----------------: | ------------: | ---------------: |
| 128×50   | today                                            |          45 ms |         **166 ms** |       41.7 KB |           135 ms |
|          | + Ink cross-frame caches ([PERF2-01](#perf2-01)) |          22 ms |             119 ms |       41.7 KB |            83 ms |
|          | + leading-edge panel ([PERF2-02](#perf2-02))     |          23 ms |          **23 ms** |       20.9 KB |            80 ms |
|          | + incremental rendering ([PERF2-03](#perf2-03))  |          23 ms |              27 ms |   **11.1 KB** |            67 ms |
| 200×60   | today                                            |          71 ms |         **228 ms** |       59.3 KB |           165 ms |
|          | + caches                                         |          25 ms |             126 ms |       59.3 KB |            79 ms |
|          | + leading-edge panel                             |          29 ms |          **29 ms** |       29.7 KB |            77 ms |
|          | + incremental                                    |          31 ms |              40 ms |   **15.3 KB** |            74 ms |
| 250×70   | today                                            |          89 ms |         **270 ms** |       76.3 KB |           178 ms |
|          | + caches                                         |          29 ms |             134 ms |       76.3 KB |            95 ms |
|          | + leading-edge panel                             |          36 ms |          **38 ms** |       38.2 KB |           107 ms |
|          | + incremental                                    |          37 ms |              50 ms |    **4.6 KB** |           149 ms |

_2,000 tasks, production bundle, truecolor, 30 paced `↓` (400 ms apart) and a 30-key burst at 33 ms (a held key). "Settled" is the last byte written for the key; "held-key backlog" is how long the screen keeps moving after the key is released. Each line adds to the one above._

| #   | ID                    | Sev.   | Conf.      | One-liner                                                                                                                  |
| --- | --------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | [PERF2-01](#perf2-01) | high   | prototyped | Ink re-tokenises the whole screen on every frame (≈46 ms at 200×60); cross-frame caches bring it to ≈11 ms                 |
| 2   | [PERF2-02](#perf2-02) | high   | prototyped | Every `↓` paints two full frames; the lower panel shows 130–270 ms after the key                                           |
| 3   | [PERF2-03](#perf2-03) | medium | measured   | Every frame rewrites the whole screen: 30–76 KB per key in truecolor; incremental rendering sends 4–8× less                |
| 4   | [PERF2-04](#perf2-04) | medium | measured   | Selecting all / switching view on 2,000 tasks: 80–90 ms per key in production (45 ms with PERF2-01)                        |
| 5   | [PERF2-05](#perf2-05) | low    | measured   | During a run, the animation ticker paints 8 full frames per second; Ink output is ~23× the React cost of that              |
| 6   | [PERF2-06](#perf2-06) | low    | measured   | Start-up: ~0.57 s of module loading before the first frame; a few heavy libraries could load on first use                  |
| 7   | [PERF2-07](#perf2-07) | low    | measured   | What remains after PERF2-01: text measuring (`string-width` + emoji regex) and the blank grid, ~20 % of the new frame cost |
| 8   | [TOOL2-01](#tool2-01) | medium | measured   | The profiler points at React: it is the dev build, it overcounts renders, and its "ink" time leaves out layout and write   |
| 9   | [TOOL2-02](#tool2-02) | low    | measured   | The harness forces 16 colours (`FORCE_COLOR=1`); users get truecolor, 40 % more bytes per frame                            |
| 10  | [TOOL2-03](#tool2-03) | low    | measured   | Nothing measures latency or bytes in the shipped build; `latency.ts` (added) does, but it is not in the suite or CI        |

**Recommended order:** PERF2-02 (a few lines, halves every key) → PERF2-01 (the big one; needs a decision on how to ship an Ink patch) → TOOL2-01/03 (so the next regressions are visible) → PERF2-03 (A/B on Windows Terminal first) → the rest.

---

## 2. Where a keystroke goes (production build)

`node --cpu-prof` of `dist/cli.js`, 200×60, 500 tasks, 60 paced `↓` + a 30-key burst, boot excluded:

| Package (self time)          | Today: 12.0 s busy | With the PERF2-01 prototype: 5.2 s busy |
| ---------------------------- | -----------------: | --------------------------------------: |
| `@alcalzone/ansi-tokenize`   |         **54.6 %** |                                   8.2 % |
| `ink` (output, render)       |             16.8 % |                                  47.6 % |
| garbage collector            |             10.3 % |                                   5.9 % |
| `string-width` + emoji regex |                8 % |                                    11 % |
| `yoga-layout` (incl. wasm)   |                4 % |                                    10 % |
| `react-reconciler` + `react` |                2 % |                                     5 % |
| the app (`dist/index.js`)    |              1.0 % |                                   2.8 % |

By call tree, today: `Ink.onRender` → `renderer` → `Output.get()` = **71.5 %** of all busy time. The four functions on top are `tokenize` (19 %), `diffAnsiCodes` (12 %), `styledCharsToString` (12 %) and the GC (10 %), all inside `Output`.

Per frame, measured inside `Output.get()` (temporary instrumentation, 200×60, median of 40 frames):

| Part of `Output.get()`                        |       Today | Shared caches | + line/slice caches | + row cache |
| --------------------------------------------- | ----------: | ------------: | ------------------: | ----------: |
| Background fills (89 write ops, 15,000 chars) |     11.6 ms |       10.8 ms |              0.4 ms |      0.4 ms |
| Text (≈500 write ops, 11,500 chars)           |     24.5 ms |        9.2 ms |              2.7 ms |      2.6 ms |
| Final: each row of cells → one ANSI string    |      9.6 ms |        8.3 ms |              8.8 ms |      3.7 ms |
| **Total**                                     | **46.1 ms** |   **30.2 ms** |         **12.8 ms** | **11.4 ms** |

Where the write ops come from: each visible task row is **15 text writes + 2 background writes** (≈380 characters with escapes); the 24 visible rows are about 410 of the ≈590 writes of a frame. On a `↓`, two of those rows change; the other 22 are rebuilt from scratch anyway.

---

## 3. Findings

### A. Performance

<a id="perf2-01"></a>

#### PERF2-01 — Ink re-tokenises the whole screen on every frame

- **Severity:** high · **Confidence:** prototyped (output byte-identical)
- **Where:** `node_modules/ink/build/output.js` (Ink 8.0.0): `class Output`, `OutputCaches`, `applyWriteOperation`, `get`; `render-background.js`.
- **What:** for each frame Ink creates a new `Output` and a new `OutputCaches`, so nothing survives from the previous frame. Then, for every `<Text>` and every background fill:
    1. `tokenize()` the whole string and build one `StyledChar` object per character;
    2. `styledCharsToString()` each line back to a string;
    3. when the box clips (most of ours do), tokenize that line **again** in `sliceLineToColumns` and stringify it again;
    4. tokenize the line a **third** time to write the cells into the grid.

    Then `get()` allocates a fresh grid of `width × height` cell objects (12,000 at 200×60) and stringifies every row, diffing styles cell by cell. Every step is proportional to the screen area, not to what changed. A background fill is a run of spaces in a colour, so it costs as much as text.

- **Measured:** see [section 2](#2-where-a-keystroke-goes-production-build). ≈46 ms per frame at 200×60 (production, fast desktop CPU); first byte after `↓` grows with the terminal: 45 ms (128×50) → 71 ms (200×60) → 89 ms (250×70).
- **Prototype** (three changes in `output.js`, appendix [A](#appendix-a--the-ink-prototype)):
    1. **one module-level `OutputCaches`** shared by all frames, cleared when it grows past ~20,000 entries;
    2. cache the **split lines** of a write by its text, and **clipped slices** by `(from, to, line)`;
    3. a frozen shared blank cell, and a **row cache**: when every cell of a row is the same object as in the previous frame, reuse the previous row's string.

    Result: `Output.get()` 46 → **11.4 ms**; first byte 71 → **25 ms** (200×60), 89 → 29 ms (250×70); total CPU for the same key sequence 12.0 → **5.2 s**. Under a held key the app now keeps up: it paints ~190 frames instead of ~80 for the same 30 keys, and the screen stops 79 ms after the key is released instead of 165 ms. The raw output of the same key sequence was compared byte for byte with the unpatched Ink: **identical**.

    Why it is safe: the cached `StyledChar` arrays are never mutated (Ink replaces cells, it does not edit them; `blankCell` copies), and the keys are the full strings, so a change of text, colour or width misses the cache.

- **Fix — how to ship it** (this is the decision to make):
    - Ink is an external dependency of the published package (`tsup.config.ts` bundles only `src/`), so `patch-package` would fix the repository but **not** users' installs.
    - **Recommended:** bundle a patched Ink into `dist` (`noExternal: ["ink"]` in `tsup.config.ts`, with the patch applied by `patch-package` at install time in the repository, and `yoga-layout` left external), and open the same change upstream ([vadimdemedes/ink](https://github.com/vadimdemedes/ink)); drop the bundling when a release has it. Alternative: a scoped fork (`@goblin-malin/ink`).
    - Add a `scripts/tui-test/bench` micro-benchmark that renders a fixed tree twice through `Output` and asserts the second frame is ≥3× cheaper, so an Ink upgrade that loses the patch is caught.

<a id="perf2-02"></a>

#### PERF2-02 — Every `↓` paints two full frames, the second one late

- **Severity:** high · **Confidence:** prototyped
- **Where:** `src/components/SecondaryPanel/SecondaryPanel.tsx:49` (`useDebouncedValue(liveSelectedTask, 80)`), `src/hooks/useDebouncedValue.ts` (trailing edge only).
- **What:** the lower panel follows the cursor through an 80 ms **trailing** debounce, to keep a held arrow key smooth (the comment says the panel is "the dominant per-keystroke render cost" — true of React in the dev build, not of the production frame, see TOOL2-01). For a single press, which is most presses, that means:
    - frame 1 (cursor moves) at ~25–90 ms;
    - 80 ms of nothing;
    - frame 2 (panel) — another **full-screen** frame, same cost as the first.

    Measured chunk timing of one `↓` at 200×60 (with PERF2-01): 16 KB at +41 ms, then 30 KB at **+158 ms**. Without PERF2-01 the panel lands at +200–270 ms. That gap is visible: the row is highlighted, the details below still show the previous track.

- **Prototype:** a leading-and-trailing debounce. When the value changes and the previous change was more than 80 ms ago, return the new value at once (same commit as the cursor); while changes keep coming faster than that (a held key), behave as today. Measured with PERF2-01: settled 126 → **29 ms** (200×60), 119 → 23 ms (128×50), bytes per key halved, burst behaviour unchanged (77 vs 79 ms backlog).
- **Fix:** add a `leading` option to `useDebouncedValue` (state + a ref holding the time of the last change; no extra timer), use it in `SecondaryPanel`. Check that the first key of a held sequence (which now paints the panel once) stays under budget at 250×70; it does in the measurements above.

<a id="perf2-03"></a>

#### PERF2-03 — Every frame rewrites the whole screen

- **Severity:** medium (likely high on Windows; not measured there) · **Confidence:** measured
- **Where:** `src/index.tsx:112-116` (render options: no `incrementalRendering`); `ink/build/log-update.js` (`createStandard` erases every line and writes the full frame).
- **What:** each frame sends `eraseLines(previousLineCount)` plus the full text of the screen. In truecolor that is 20.9 KB (128×50), 29.7 KB (200×60) and 38.2 KB (250×70) **per frame**. The terminal has to parse and draw all of it. A dump of one frame shows why it is large: 2,700 escape sequences for 6,400 cells, 808 of them `\x1b[39m` (reset foreground) immediately followed by a new foreground.

    Ink 8's `incrementalRendering: true` rewrites only the lines that changed. Part 1 measured its CPU (no gain) and left the bytes unmeasured; here are the bytes:

    | Terminal | Bytes per `↓`, today (2 frames) | With PERF2-01/02 (1 frame) |         + incremental |
    | -------- | ------------------------------: | -------------------------: | --------------------: |
    | 128×50   |                         41.7 KB |                    20.9 KB |           **11.1 KB** |
    | 200×60   |                         59.3 KB |                    29.7 KB |           **15.3 KB** |
    | 250×70   |                         76.3 KB |                    38.2 KB | **4.6 KB** (max 19.7) |

    On this Linux container it costs a few ms of CPU (settled 29 → 40 ms at 200×60), because computing the line diff is not free and the PTY here is fast. On **Windows, ConPTY and Windows Terminal** parse and repaint every byte; a 4–8× cut is the kind of change that is felt there, and over SSH.

- **Fix:** A/B it on Windows Terminal with `latency.ts` (it measures the first byte and the last byte, not the terminal's own repaint, so also time it by eye or with a screen recording), then turn it on, or make it a setting ("Reduce terminal output") defaulting to on for Windows. Separately, the redundant `39`/`38;2;…` pairs come from Ink's `styledCharsToString`; worth reporting upstream with the PERF2-01 patch.

<a id="perf2-04"></a>

#### PERF2-04 — Select all / view switch on 2,000 tasks: 80–90 ms per key

- **Severity:** medium · **Confidence:** measured (cause after PERF2-01 not isolated)
- **What:** production bundle, 2,000 tasks, 200×60, 16 alternating presses each:

    | Keys                          | Today: first byte p50 / p95 | With PERF2-01 |
    | ----------------------------- | --------------------------: | ------------: |
    | `Ctrl+A` / `Esc`              |                  87 / 99 ms |    45 / 54 ms |
    | `2` / `1` (view switch)       |                 79 / 130 ms |    42 / 57 ms |
    | `Tab` (focus the lower panel) |                 88 / 106 ms |    34 / 52 ms |

    About half is the Ink frame. The other half is React work over the whole list: `selectAllTasks(tasks.map(t => t.getId()))` (`useKeyHandlers.ts:195`) builds 2,000 ids and every visible row re-renders with a new selection; the view switch remounts every visible row's cells. In the dev profile (`perf-scale-2000`), `Escape` blocks the event loop 93 ms and `1` 156 ms.

- **Fix:** after PERF2-01 lands, re-profile these two with `latency.ts --cpu-prof` (see [section 6](#6-how-to-reproduce)) before changing anything; then consider storing "all selected" as a flag instead of a 2,000-entry set, and keeping the cell components mounted across view switches.

<a id="perf2-05"></a>

#### PERF2-05 — During a run, each animation tick is a full frame

- **Severity:** low (becomes negligible with PERF2-01) · **Confidence:** measured
- **What:** `perf-load-tasks` (dev build, 128×50, 1,000 tasks, 40 tasks changing every 250 ms): over 12 s, 91 commits, **169 ms of React and 3,942 ms of Ink output**; 5.6 s of process CPU, i.e. ~46 % of a core, before the user touches a key. The shared ticker (`useGlobalTicker`, 125 ms) and status updates are already coalesced to one commit each — the count is fine, the cost per frame is not. Keys pressed during the run (`ArrowDown` in that scenario) wait behind those frames: 40–87 ms of Ink per key, one key with 27 commits queued behind it.
- **Fix:** PERF2-01 (an unchanged row costs nearly nothing, so a tick that only moves spinners becomes a few ms). If it is still visible after that, slow the row spinners to 250 ms when more than N rows animate.

<a id="perf2-06"></a>

#### PERF2-06 — Start-up loads every library before the first frame

- **Severity:** low · **Confidence:** measured
- **What:** `import("./dist/index.js")` takes **570 ms** before `start()` runs; the first frame of a 2,000-task session is settled at ~1.0–1.3 s. Standalone import times of the heaviest dependencies (each in a fresh Node): `ink` 306 ms (most of it is compiling Yoga's wasm, unavoidable), `ytmusic-api` 136 ms, `clipboardy` 112 ms, `musicbrainz-api` 46 ms, `winston` 45 ms, `wrap-ansi` 45 ms, `slsk-client` 35 ms, `ytdlp-nodejs` 33 ms, `open` 32 ms. They overlap (shared dependencies), so the saving is less than the sum.
- **Fix:** `await import()` on first use for the libraries only a pipeline step or an action needs (`ytmusic-api`, `clipboardy`, `slsk-client`, `musicbrainz-api`, `open`, `adm-zip`, `7zip-bin`), inside the service methods that use them. Measure with `node --cpu-prof dist/cli.js` and the `bootMs` of `latency.ts`. Expect 100–250 ms.

<a id="perf2-07"></a>

#### PERF2-07 — What is left after PERF2-01

- **Severity:** low · **Confidence:** measured
- **What:** with the prototype, the profile's new top items are:
    - `Output.get` itself (21 % self): allocating 12,000 grid cells and comparing rows cell by cell;
    - `stringWidth` + the `^\p{RGI_Emoji}$` regex (11 %): called by `widestLine` in `render-node-to-output.js` and by Yoga's text measuring, **uncached**, for every text node on every frame;
    - Yoga layout (10 %), the reconciler (5 %).
- **Fix (upstream, with PERF2-01):** build the grid with `Array(width).fill(BLANK)`, keep the previous frame's row strings keyed by the row's write operations instead of comparing cells, and memoise `widestLine`/`measureText` by string (a module-level LRU). App side: fewer `Text` nodes per task row (15 today; several fixed-width cells could be one `Text` with nested styled `Text`, which Ink squashes into a single write).

### B. Tests & tooling

<a id="tool2-01"></a>

#### TOOL2-01 — The render profiler points at React

- **Severity:** medium · **Confidence:** measured / verified
- **What:** three separate problems, which together explain why part 1 and the code comments optimise React renders while users wait on Ink:
    1. **Dev build only.** In the dev profile of `perf-scale-2000`, a `↓` shows ~11 ms React and ~35 ms "ink". In production, React and the reconciler are 2–5 % of CPU and Ink's output 75–83 % (section 2). The ratio is not the same, so the dev numbers rank the wrong things first.
    2. **Render counts are inflated.** `src/profiling/install.ts` walks the **whole** fiber tree on every commit and counts a fiber as rendered when `alternate == null` ("mount") or its `PerformedWork` flag is set. A fiber that was mounted once and never re-rendered keeps `alternate == null` forever, and a subtree that bailed out keeps the stale flags of its last render. Evidence in the `perf-scale-2000` timeline (`profiling/timeline.ts`): commits that took **0.1 ms** of React list `FieldRow×10 1.9ms`, and `Uri×N [mount]` grows by one at every `↓` (×16, ×17, … ×38) while the screen shows the same number of links. So the "renders", "wasted" (17,746 `Box`, 13,370 `Text`) and **render-count baselines** — the "machine-independent" regression signal of the suite — are not reliable.
    3. **"ink" ms is not the frame.** `onRender`'s `renderTime` (`ink.js:236-239`) times only `renderer()` (the `Output` stage). Yoga layout (`calculateLayout`, run from `resetAfterCommit`) and the terminal write (`log-update`) are outside it.
- **Fix:**
    1. Walk the tree the way React DevTools does: start from the root, and only descend into a child list when `fiber.child !== fiber.alternate?.child` (otherwise the subtree was reused untouched); a fiber is a mount only if it is reached in that walk with no alternate.
    2. Wrap `calculateLayout` and the write in the profiled entry so a frame record has `layoutMs`, `outputMs`, `writeMs` and `bytes`.
    3. Add a `"build": "production"` scenario option that runs the profiled entry with `NODE_ENV=production` (frame timings and process samples are still valid there; per-component times are not), and make the `perf-*` suite report it.

<a id="tool2-02"></a>

#### TOOL2-02 — The harness renders in 16 colours

- **Severity:** low · **Confidence:** measured
- **Where:** `scripts/tui-test/runner.ts` (`FORCE_COLOR: "1"`).
- **What:** level 1 maps every theme colour to one of 16 ANSI colours. Users on Windows Terminal, iTerm2, most Linux terminals get truecolor (level 3). Same frame, 128×50: **29.4 KB** at level 1, **41.8 KB** at level 3; per-frame CPU also differs (longer escape sequences to tokenise). Screenshots taken by the built-in emulator also show approximated colours.
- **Fix:** default to `FORCE_COLOR: "3"` (keep `COLORTERM=truecolor`, already set), with a scenario `env` override for the rare test that wants 16 colours. Re-create the baselines afterwards (they are being re-created anyway for TOOL2-01).

<a id="tool2-03"></a>

#### TOOL2-03 — Nothing measures what the user feels

- **Severity:** low · **Confidence:** verified
- **What:** the suite measures commits, React ms and dev-build Ink ms. None of these is "how long after the key does the screen settle" or "how many bytes did the terminal get", in the shipped build. PERF2-02 (a deliberate 80 ms delay before a second full frame) is invisible to all current metrics: it shows only as "2 commits".
- **Added with this audit:** [`scripts/tui-test/bench/latency.ts`](scripts/tui-test/bench/latency.ts). It runs any command (default `node dist/cli.js`) on a throwaway, optionally scaled fixture and reports, per key: first byte p50/p95, settled p50/p95, bytes and writes; and for a held key: the backlog after release. Options: `--key/--back-key` (alternating pairs), `--pre`, `--cols/--rows`, `--tasks`, `--color`, `--dump` (raw output of one key + chunk times).
- **Fix:** run it from `perfSuite.ts` (a few configurations: 128×50 and 200×60, 2,000 tasks, `↓` and `Ctrl+A`/`Esc`) and store its numbers with the rest; add a CI check on what is machine-independent: **frames per isolated key = 1** and **bytes per key** within 10 % of a baseline.

---

## 4. Targets for the implementation

Machine-independent targets first (they can gate CI); the ms targets are for this kind of machine, production build, 200×60, 2,000 tasks.

| Metric                                         |        Today |       Target | Reached by the prototypes |
| ---------------------------------------------- | -----------: | -----------: | ------------------------: |
| Full frames per isolated `↓`                   |            2 |        **1** |                         1 |
| Bytes per isolated `↓`                         |      59.3 KB |      ≤ 16 KB |   15.3 KB (with PERF2-03) |
| `Output.get()` per frame                       |        46 ms |      ≤ 12 ms |                   11.4 ms |
| `↓` settled p50 / p95                          | 228 / 275 ms | ≤ 40 / 60 ms |                29 / 41 ms |
| Backlog after a held key (30 keys at 33 ms)    |       165 ms |      ≤ 80 ms |                     77 ms |
| `Ctrl+A` / `Esc` first byte p50                |        87 ms |      ≤ 40 ms |     45 ms (PERF2-01 only) |
| Process CPU while a run animates (dev, 128×50) |   ~46 % core |       ≤ 15 % |              not measured |

## 5. Coverage & limits

- **Not measured on Windows.** The user base is mostly Windows (PowerShell tooling, `C:\Music`), where ConPTY and Windows Terminal add their own cost per byte. Everything here was measured on Linux through `node-pty`, which is fast; PERF2-03 in particular needs an A/B there. Absolute ms will differ; the ratios (frames per key, bytes, `Output.get` before/after) should hold.
- The prototypes were temporary edits of `node_modules/ink/build/*.js` and `dist/index.js`, switched by environment variables, and are **reverted** (`ink` files restored from backups, `dist` rebuilt). The only file added to the repository is `scripts/tui-test/bench/latency.ts`. Nothing in `src/` was changed.
- The output comparison of PERF2-01 was byte-for-byte on one key sequence (8 `↓` + a burst, 200×60). Before shipping, run the e2e tests and the screenshot scenarios with the patched Ink, including wide characters (CJK titles) and a resize.
- No real network pipeline was run (no Spotify/YouTube/Soulseek); the run-time load is the synthetic `perf-load-tasks`.
- Memory was not re-examined (heap max 144 MB at 2,000 tasks, 165 MB at 1,000 + 500 in other sessions, dev build).

## 6. How to reproduce

```bash
yarn build
```

```bash
yarn tsx scripts/tui-test/bench/latency.ts --tasks 2000 --cols 200 --rows 60 --count 30 --interval 400 --burst 30
```

```bash
yarn tsx scripts/tui-test/bench/latency.ts --tasks 2000 --cols 200 --rows 60 --pre ArrowDown --key Ctrl+A --back-key Escape --count 16 --interval 700 --burst 0
```

```bash
yarn tsx scripts/tui-test/bench/latency.ts --cmd "node --cpu-prof --cpu-prof-dir=prof dist/cli.js" --tasks 500 --cols 200 --rows 60 --count 60 --interval 400
```

Use `--interval 400` or more: the second frame of PERF2-02 lands 130–270 ms after the key, and a shorter window cuts it off (it then shows as "settled" too early and half the bytes).

## Appendix A — the Ink prototype

The three changes to `node_modules/ink/build/output.js` (Ink 8.0.0), without the measurement code and environment switches used during the audit:

```js
// 1. One cache for all frames (was: one per Output, i.e. per frame).
const SHARED = new OutputCaches(); // + `lines` and `slices` Maps
const BLANK = Object.freeze({ type: "char", value: " ", fullWidth: false, styles: [] });
const previousRows = [];
function sharedCaches() {
    if (SHARED.styledChars.size > 20000 || SHARED.widths.size > 50000) {
        SHARED.styledChars.clear();
        SHARED.widths.clear();
        SHARED.blockWidths.clear();
        SHARED.lines.clear();
        SHARED.slices.clear();
    }
    return SHARED;
}
export default class Output {
    caches = sharedCaches();
    // ...

    applyWriteOperation(output, operation, clip) {
        // 2a. Split lines once per distinct text.
        let lines = this.caches.lines.get(text);
        if (lines === undefined) {
            /* existing tokenize + split + styledCharsToString */
            this.caches.lines.set(text, lines);
        }
        // 2b. Clipped slices once per (from, to, line).
        //     key = `${from}|${to}|${line}` → this.sliceLineToColumns(line, from, to)
        // ...
    }

    get() {
        // 3a. Blank cells share one frozen object (row.push(BLANK)).
        // 3b. A row whose cells are all the same objects as last frame reuses last frame's string:
        //     if (prev && prev.cells.length === line.length && prev.cells.every((c, i) => c === line[i])) return prev.str;
        // ...
    }
}
```

The leading-edge debounce of PERF2-02, as prototyped:

```ts
export function useDebouncedValue<T>(value: T, delayMs: number, { leading = false } = {}): T {
    const [debounced, setDebounced] = useState(value);
    const ref = useRef({ prev: value, last: 0, lead: value });
    const r = ref.current;
    if (leading && !Object.is(r.prev, value)) {
        const now = Date.now();
        if (now - r.last > delayMs) r.lead = value; // first change after a pause: show it now
        r.last = now;
        r.prev = value;
    }
    useEffect(() => {
        if (Object.is(debounced, value)) return;
        const id = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(id);
    }, [value, delayMs, debounced]);
    return leading && Object.is(r.lead, value) ? value : debounced;
}
```

(Writing refs during render is what the React lint rule warns about; the implementation can keep the same logic in state with the "adjust state during render" pattern.)
