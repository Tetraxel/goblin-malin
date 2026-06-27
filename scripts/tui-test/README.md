# TUI Test Harness

Headless scenario runner for validating user flows and visual appearance without running the app manually.

## Running a scenario

```bash
# Machine-readable output (JSON with snapshots + metrics)
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json

# Human-readable: live event stream + inline ANSI snapshots
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json --pretty
```

`--pretty` is best for interactive debugging. Plain JSON is best for automated validation — parse `result.snapshots["name"].plain` to assert on screen content.

## Scenario file format

Scenarios are JSON files in `scripts/tui-test/examples/`.

```jsonc
{
    "terminal": { "cols": 128, "rows": 64 }, // optional, defaults: 200×50
    "dataDir": "scripts/tui-test/fixtures/empty", // optional: sets GOBLIN_DATA_DIR
    "steps": [ /* ...see step types below... */ ]
}
```

## Step types

| Step | Purpose |
|------|---------|
| `{ "type": "key", "key": "Enter" }` | Send a key. See key reference below. |
| `{ "type": "type", "text": "hello" }` | Type raw text. |
| `{ "type": "wait", "ms": 500 }` | Fixed delay. |
| `{ "type": "stable" }` | Wait for terminal output to stop for 300ms (app finished rendering). Add `"timeout": 8000` or `"quiescenceMs": 500` to tune. |
| `{ "type": "waitForContent", "text": "No task" }` | Block until the given text appears on screen. Add `"timeout": 10000` (ms). |
| `{ "type": "assert", "contains": "Settings" }` | Fail immediately if the text is not on screen. |
| `{ "type": "snapshot", "name": "my-state" }` | Capture terminal state. Accessible in output as `result.snapshots["my-state"].plain` (text) or `.ansi` (with colors). |
| `{ "type": "screenshot", "name": "my-shot" }` | Render a PNG via the built-in terminal emulator. Fast, no external dependency, but fonts and glyphs are approximate. |
| `{ "type": "screenshot-powershell", "name": "my-shot" }` | Render a PNG via Windows Terminal — real font, box-drawing, emoji. Saved to `%TEMP%\goblin-tui-test\<name>.png`. Closest to what the user actually sees, but slower (~3–5s). **Preferred for visual validation.** |
| `{ "type": "screenshot-browser", "name": "my-shot" }` | ⚠️ Deprecated. Render a PNG via headless Edge + xterm.js. |

## Key reference

Named keys (use in `"key"` field):

```
Enter  Esc  Tab  Shift+Tab  Space  Del
←  →  ↑  ↓                          (or: ArrowLeft  ArrowRight  ArrowUp  ArrowDown)
Shift+←  Shift+→  Shift+↑  Shift+↓
Ctrl+A  Ctrl+C  Ctrl+D  Ctrl+N  Ctrl+R  Ctrl+S  Ctrl+V
```

Single characters pass through as-is: `"D"`, `"E"`, `"1"`, `"y"`, etc.

## Typical validation pattern

```jsonc
{ "type": "stable", "timeout": 8000 },                   // wait for app boot
{ "type": "waitForContent", "text": "No task" },         // confirm initial state
{ "type": "key", "key": "→" },                           // navigate
{ "type": "stable" },                                    // wait for re-render
{ "type": "assert", "contains": "Settings" },            // verify outcome
{ "type": "snapshot", "name": "after-nav" },             // capture for inspection
{ "type": "screenshot-powershell", "name": "after-nav" } // visual proof
```

## Fixtures

`scripts/tui-test/fixtures/empty/` — blank data directory (no sessions, no cache). Use it as `"dataDir"` to start the app in a clean state.
