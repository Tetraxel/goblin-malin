# P24 — First-Run Experience & Setup Doctor: Tasks

## Context

**Three of the five release blockers in TODO.md are onboarding problems**, and they share one root cause: the app depends on external state (binaries, cookies, credentials, paths) that it neither verifies nor helps the user establish.

- **Cookies**: [YtDlpService](../../../src/flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService.ts) looks for `bin/cookies.txt` and, if missing, logs `"No cookies file found, proceeding without cookies"` — then YouTube's bot-check ("Sign in to confirm you're not a bot") fails the download with a raw error the user can't interpret. Blocker: *"Easier cookies.txt extraction for yt-dlp"*.
- **Paths**: settings rows for directories/binaries are raw text inputs. Blocker: *"Better way to select the app path in settings"*.
- **Dependencies**: FLAC conversion needs ffmpeg; audio preview needs mpv ([mpv-setup.ts](../../../src/utils/mpv-setup.ts)); nothing checks any of it until a task fails mid-run.

The wizard infrastructure ([setupWizard.ts](../../../src/base/setupWizard.ts): modes, content blocks, env-var fields, links; rendered by `SetupWizardModal`) is solid — what's missing is (a) a **diagnostic layer** that tells the user what's broken and (b) two wizard-shaped gaps: cookies and path picking. For a pre-release product, "installable by a stranger without reading the source" is the highest-value improvement there is.

---

## Tasks

### T24.1 — Doctor engine

`src/base/doctor.ts` — a check registry, decoupled from UI:

```typescript
interface DoctorCheck {
    id: string;                        // "ytdlp-binary", "cookies", …
    label: string;
    severity: "required" | "recommended";
    run(): Promise<CheckResult>;
}
type CheckResult =
    | { status: "ok"; detail?: string }          // "yt-dlp 2026.06.10"
    | { status: "warn" | "fail"; detail: string; fix?: FixAction };
type FixAction =
    | { kind: "wizard"; config: SetupWizardConfig }
    | { kind: "action"; label: string; run(): Promise<void> }   // e.g. auto-download binary
    | { kind: "link"; label: string; url: string };
```

Initial checks: yt-dlp binary present + `--version` (fix: auto-download via the existing binary management), ffmpeg on PATH or in bin dir, mpv present (`recommended` — preview-only), `cookies.txt` present + **age** (warn > 30 days: cookies expire, this is the #1 silent failure), Spotify auth mode configured & credentials non-empty (per P14 mode), output directory exists & writable, network reachability (one HEAD request).

Providers can contribute checks: an optional `static doctorChecks?: DoctorCheck[]` on service classes, collected through the registries — consistent with how `display`/`defaultSettings` already work.

_Depends on: nothing_

---

### T24.2 — Doctor modal

- Toolbar button (pattern of [useSettingsButton.ts](../../../src/components/Toolbar/useSettingsButton.ts)) opening a modal that runs all checks concurrently and renders live rows: `✓ yt-dlp 2026.06.10` / `⚠ cookies.txt is 41 days old` / `✗ ffmpeg not found`.
- `[Enter]` on a failed row triggers its `FixAction` (opens the wizard, runs the download, opens the link); re-runs that check on return. `[R]` re-runs all. All shortcuts registered via `useShortcuts`, hints via `Hint`.
- **First-run**: after the WelcomeModal, auto-open the doctor if any `required` check fails (gated by a `general.skipDoctorOnStartup` setting once the user dismisses it).

_Depends on: T24.1_

---

### T24.3 — Cookies wizard (release blocker)

A `SetupWizardConfig` with two modes (the infra already supports mode choosers):

- **Mode A — from browser (recommended)**: `ytdlp-nodejs` supports `cookiesFromBrowser`; the wizard picks the browser (chrome/firefox/edge/brave) and stores `download.ytdlp.cookiesMode = "browser:<name>"`. No file handling at all — this makes the blocker disappear for most users. `YtDlpService` passes `cookiesFromBrowser` instead of `cookies` when set.
- **Mode B — cookies.txt file**: step-by-step content blocks (install "Get cookies.txt LOCALLY" extension → export youtube.com → paste the file path), with the path field validated on submit: file exists, first line smells like Netscape format (`# Netscape HTTP Cookie File` or tab-separated), contains `youtube.com` lines. On success the file is **copied** into `bin/cookies.txt` so the original can live anywhere (drag-and-dropping a file onto most terminals pastes its path — document that in the wizard text).
- Doctor's cookies check deep-links to this wizard as its `fix`.

_Depends on: T24.1 (fix wiring); wizard itself has no dependency_

---

### T24.4 — Path picker component (release blocker)

`src/components/PathPickerModal/` — a keyboard directory/file browser:

- `↑/↓` navigate entries, `→`/`Enter` descend, `←` parent, typed prefix filters, `Tab` autocompletes, `Ctrl+H` toggles hidden files; footer hints via `Hint`. Directory-select and file-select modes (file mode takes an extension filter, e.g. `.txt` for cookies).
- New `SettingsItem` kind `"path"`: rows render the current value and open the picker on `Enter` — replacing raw text inputs for output directory, binary paths, and the cookies file (T24.3 mode B reuses it).
- Async `fs.promises.readdir` with a cap per directory (guard against `node_modules`-sized listings).

_Depends on: nothing_

---

### T24.5 — Actionable error mapping

`src/flows/musicDownloadFlow/services/download-providers/ytdlp/errorMap.ts` — match known yt-dlp stderr patterns to user-facing status + fix hint:

| Pattern (stderr contains)                     | Status message                          | Hint / fix                     |
| --------------------------------------------- | --------------------------------------- | ------------------------------ |
| `Sign in to confirm you're not a bot`          | "YouTube bot-check — cookies needed"    | deep-link cookies wizard       |
| `age`-restriction phrasing                     | "Age-restricted — cookies needed"       | deep-link cookies wizard       |
| `Video unavailable` / `has been removed`       | "Video removed"                          | suggest re-search (`s` action) |
| `HTTP Error 403`                               | "Blocked (403) — retry or update yt-dlp"| doctor binary check            |

The mapped `fix` surfaces in the task's status message and in the download panel detail; the raw stderr stays in the logs (P16 already renders rich per-task logs).

_Depends on: T24.1, T24.3_

---

### T24.6 — `--doctor` CLI flag

`goblin-malin --doctor` runs all checks headless and prints a plain-text report (no Ink) with exit code 0/1. Cheap to build on T24.1, and turns "it doesn't work" bug reports into paste-able diagnostics.

_Depends on: T24.1_

---

### T24.7 — Tests

- Unit: each check with mocked fs/spawn (present/missing/stale matrices); cookies file validation; error-map pattern table.
- TUI harness: doctor modal scenario (all-green fixture + one-failure fixture → fix action opens wizard); path picker navigation scenario.

_Depends on: T24.1–T24.5_

---

## Summary

| Task  | What                                                      | Depends on  |
| ----- | ---------------------------------------------------------- | ----------- |
| T24.1 | Doctor check engine + provider-contributed checks          | —           |
| T24.2 | Doctor modal + first-run auto-open                         | T24.1       |
| T24.3 | Cookies wizard: browser mode + validated file mode         | —           |
| T24.4 | `PathPickerModal` + `"path"` settings kind                 | —           |
| T24.5 | yt-dlp error → actionable status mapping                   | T24.1, T24.3|
| T24.6 | Headless `--doctor` CLI flag                               | T24.1       |
| T24.7 | Unit + TUI-harness coverage                                | T24.1–T24.5 |
