# P9 — Color Theme Unification

## Goal

Replace ~50 hardcoded Ink color strings (`"cyan"`, `"white"`, `"gray"`, `"red"`, `"green"`, `"yellow"`, `"blue"`, `"whiteBright"`) scattered across component files with a centralized two-layer theme system:

1. A **`ThemePalette`** — named base colors (blue, cyan, red, green …) for the theme
2. **Semantic tokens** organized by UI role (`ui.border`, `status.error`, `field.overridden` …) that map to palette values
3. Two built-in JSON themes (`dark` — GitHub Dark, `light` — GitHub Light) stored in `src/assets/themes/`
4. A React context + `useTheme()` hook consumed by every component
5. A **Theme selector** (`select` item kind) in the Settings modal → General section

Provider/service brand colors (`src/base/providerDisplay.ts`, `BUILTIN_PROVIDERS`) are **excluded** — they are brand identity, not UI theme. Logger chalk colors are also excluded.

---

## Theme interface (`src/base/theme.ts`)

```typescript
export interface ThemePalette {
  blue: string; // accent / link blue
  cyan: string; // teal / cyan
  red: string; // red / rose
  green: string; // green / emerald
  yellow: string; // amber / yellow
  orange: string; // orange
  purple: string; // purple / violet
  pink: string; // pink / magenta
  white: string; // near-white foreground
  gray: string; // mid gray
  grayDark: string; // dark gray
}

export interface Theme {
  palette: ThemePalette;

  // ── Structural UI elements ───────────────────────────────────────────
  ui: {
    border: string; // box/panel outer borders          (was "cyan")
    separator: string; // ─── horizontal rule lines        (was "cyan")
    selection: string; // ☛ cursor & selection highlight   (was "cyan")
    tabActive: string; // active tab color indicator        (was "cyan")
    tabInactive: string; // inactive tab text                 (was "gray")
    panelTitle: string; // panel/section header label        (was "cyan" or "white")
    progressFill: string; // filled portion of progress bar   (was "green")
    progressEmpty: string; // empty portion of progress bar    (was "gray")
    modalBorder: string; // modal overlay border color        (was "cyan")
    focusIndicator: string; // ☛ arrow / focus cursor           (was "cyan"/"white")
    dimText: string; // heavily dimmed text               (was "gray"+dimColor)
  };

  // ── Text hierarchy ────────────────────────────────────────────────────
  text: {
    primary: string; // main content text                     (was "white")
    secondary: string; // labels, metadata, subtitles           (was "gray")
    muted: string; // very dim, disabled, filler            (was "gray"+dimColor)
    hint: string; // action bar hints, footer shortcuts    (was "gray")
    active: string; // focused / actively-edited label       (was "white")
    heading: string; // section/modal titles                  (was "white" bold)
  };

  // ── Task / download status states ─────────────────────────────────────
  status: {
    processing: string; // task currently running              (was "blue")
    pending: string; // waiting for user action             (was "white")
    success: string; // completed successfully              (was "green")
    warning: string; // in-progress or degraded             (was "yellow")
    error: string; // failed                              (was "red")
    skipped: string; // skipped / neutral                   (was "gray")
    locked: string; // saved / write-locked                (was "whiteBright")
    downloading: string; // actively downloading                (was "yellow")
  };

  // ── Metadata field states (FieldRow, MetadataCompiledRow) ─────────────
  field: {
    normal: string; // standard field value                 (was "white")
    overridden: string; // manually overridden / edited         (was "yellow")
    missing: string; // empty / not populated                (was "gray")
    selected: string; // selected for inline editing          (was "green")
    error: string; // validation error on field            (was "red")
  };

  // ── Confidence badges (MetadataSourceRow) ─────────────────────────────
  confidence: {
    high: string; // ≥ 90 %                                  (was "green")
    medium: string; // ≥ 70 %                                  (was "yellow")
    low: string; // ≥ 50 %                                  (was "gray")
    veryLow: string; // < 50 %                                  (was "red")
  };

  // ── Diff view (DiffRow, DiffView) ──────────────────────────────────────
  diff: {
    base: string; // old / base-side text                   (was "gray")
    changed: string; // new / changed-side text                (was "cyan")
    modified: string; // change indicator glyph/arrow           (was "yellow")
  };

  // ── Toolbar action buttons ─────────────────────────────────────────────
  action: {
    primary: string; // main call-to-action (import, run-all)  (was "yellow")
    destructive: string; // irreversible action (exit, delete)      (was "red")
    neutral: string; // settings, info                          (was "gray"/"#a0a0a0")
  };
}

export const THEME_KEYS = ["dark", "light"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export function loadTheme(key: string): Theme;
// Falls back to 'dark' if key is unrecognized.
```

---

## Color mapping reference

| Hardcoded value | Semantic context          | Token                                    |
| --------------- | ------------------------- | ---------------------------------------- |
| `"cyan"`        | borders, separators       | `theme.ui.border` / `theme.ui.separator` |
| `"cyan"`        | selection / cursor        | `theme.ui.selection`                     |
| `"cyan"`        | modal borders             | `theme.ui.modalBorder`                   |
| `"cyan"`        | active tab indicator      | `theme.ui.tabActive`                     |
| `"cyan"`        | diff changed side         | `theme.diff.changed`                     |
| `"white"`       | primary text              | `theme.text.primary`                     |
| `"white"`       | panel titles              | `theme.text.heading`                     |
| `"white"`       | active / focused          | `theme.text.active`                      |
| `"gray"`        | secondary text            | `theme.text.secondary`                   |
| `"gray"`        | hints / footer            | `theme.text.hint`                        |
| `"gray"`        | dimmed / muted            | `theme.text.muted`                       |
| `"gray"`        | progress empty bar        | `theme.ui.progressEmpty`                 |
| `"gray"`        | diff base side            | `theme.diff.base`                        |
| `"gray"`        | skipped status            | `theme.status.skipped`                   |
| `"gray"`        | inactive tab              | `theme.ui.tabInactive`                   |
| `"gray"`        | neutral action            | `theme.action.neutral`                   |
| `"red"`         | error states              | `theme.status.error`                     |
| `"red"`         | field validation error    | `theme.field.error`                      |
| `"red"`         | confidence < 50 %         | `theme.confidence.veryLow`               |
| `"red"`         | destructive action button | `theme.action.destructive`               |
| `"green"`       | success states            | `theme.status.success`                   |
| `"green"`       | progress fill bar         | `theme.ui.progressFill`                  |
| `"green"`       | confidence ≥ 90 %         | `theme.confidence.high`                  |
| `"green"`       | field selected for edit   | `theme.field.selected`                   |
| `"yellow"`      | warning states            | `theme.status.warning`                   |
| `"yellow"`      | actively downloading      | `theme.status.downloading`               |
| `"yellow"`      | overridden metadata field | `theme.field.overridden`                 |
| `"yellow"`      | confidence ≥ 70 %         | `theme.confidence.medium`                |
| `"yellow"`      | diff modified indicator   | `theme.diff.modified`                    |
| `"yellow"`      | primary action button     | `theme.action.primary`                   |
| `"blue"`        | processing status         | `theme.status.processing`                |
| `"whiteBright"` | locked/saved status       | `theme.status.locked`                    |
| `"#a0a0a0"`     | neutral settings action   | `theme.action.neutral`                   |

---

## Tasks

### Phase 1 — Theme definition

| ID   | Task                                                                                                                                                                                                                                  | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.1 | Create `src/base/theme.ts` — `ThemePalette` interface, `Theme` interface (full token set above), `THEME_KEYS`, `ThemeKey` type, and `loadTheme(key: string): Theme` that imports both JSONs and falls back to `dark` for unknown keys | ⬜ Todo |
| T9.2 | Create `src/assets/themes/dark.json` — GitHub Dark-based palette + all semantic tokens (values below)                                                                                                                                 | ⬜ Todo |
| T9.3 | Create `src/assets/themes/light.json` — GitHub Light-based palette + all semantic tokens (values below)                                                                                                                               | ⬜ Todo |

#### dark.json values

```json
{
  "palette": {
    "blue": "#58a6ff",
    "cyan": "#39c5cf",
    "red": "#ff7b72",
    "green": "#56d364",
    "yellow": "#e3b341",
    "orange": "#f0883e",
    "purple": "#d2a8ff",
    "pink": "#f778ba",
    "white": "#e6edf3",
    "gray": "#8b949e",
    "grayDark": "#484f58"
  },
  "ui": {
    "border": "#39c5cf",
    "separator": "#39c5cf",
    "selection": "#58a6ff",
    "tabActive": "#58a6ff",
    "tabInactive": "#8b949e",
    "panelTitle": "#e6edf3",
    "progressFill": "#56d364",
    "progressEmpty": "#484f58",
    "modalBorder": "#39c5cf",
    "focusIndicator": "#58a6ff",
    "dimText": "#484f58"
  },
  "text": {
    "primary": "#e6edf3",
    "secondary": "#8b949e",
    "muted": "#484f58",
    "hint": "#8b949e",
    "active": "#e6edf3",
    "heading": "#e6edf3"
  },
  "status": {
    "processing": "#388bfd",
    "pending": "#e6edf3",
    "success": "#56d364",
    "warning": "#e3b341",
    "error": "#ff7b72",
    "skipped": "#8b949e",
    "locked": "#e6edf3",
    "downloading": "#e3b341"
  },
  "field": {
    "normal": "#e6edf3",
    "overridden": "#e3b341",
    "missing": "#8b949e",
    "selected": "#56d364",
    "error": "#ff7b72"
  },
  "confidence": {
    "high": "#56d364",
    "medium": "#e3b341",
    "low": "#8b949e",
    "veryLow": "#ff7b72"
  },
  "diff": {
    "base": "#8b949e",
    "changed": "#39c5cf",
    "modified": "#e3b341"
  },
  "action": {
    "primary": "#e3b341",
    "destructive": "#ff7b72",
    "neutral": "#8b949e"
  }
}
```

#### light.json values

```json
{
  "palette": {
    "blue": "#0969da",
    "cyan": "#1b7c83",
    "red": "#cf222e",
    "green": "#1a7f37",
    "yellow": "#9a6700",
    "orange": "#bc4c00",
    "purple": "#8250df",
    "pink": "#bf3989",
    "white": "#ffffff",
    "gray": "#57606a",
    "grayDark": "#24292f"
  },
  "ui": {
    "border": "#1b7c83",
    "separator": "#1b7c83",
    "selection": "#0969da",
    "tabActive": "#0969da",
    "tabInactive": "#57606a",
    "panelTitle": "#24292f",
    "progressFill": "#1a7f37",
    "progressEmpty": "#d0d7de",
    "modalBorder": "#1b7c83",
    "focusIndicator": "#0969da",
    "dimText": "#d0d7de"
  },
  "text": {
    "primary": "#24292f",
    "secondary": "#57606a",
    "muted": "#d0d7de",
    "hint": "#57606a",
    "active": "#24292f",
    "heading": "#24292f"
  },
  "status": {
    "processing": "#0550ae",
    "pending": "#24292f",
    "success": "#1a7f37",
    "warning": "#9a6700",
    "error": "#cf222e",
    "skipped": "#57606a",
    "locked": "#24292f",
    "downloading": "#9a6700"
  },
  "field": {
    "normal": "#24292f",
    "overridden": "#9a6700",
    "missing": "#57606a",
    "selected": "#1a7f37",
    "error": "#cf222e"
  },
  "confidence": {
    "high": "#1a7f37",
    "medium": "#9a6700",
    "low": "#57606a",
    "veryLow": "#cf222e"
  },
  "diff": {
    "base": "#57606a",
    "changed": "#1b7c83",
    "modified": "#9a6700"
  },
  "action": {
    "primary": "#9a6700",
    "destructive": "#cf222e",
    "neutral": "#57606a"
  }
}
```

---

### Phase 2 — Settings integration

| ID   | Task                                                                                                                                                                                                | Status  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.4 | Add `theme: string` (default `"dark"`) to `AppSettings.general` in `src/settings/appSettings.ts`                                                                                                    | ⬜ Todo |
| T9.5 | Add `select` kind to `SettingsItem` discriminated union in `src/settings/buildSettingsItems.ts`; update `isInteractive()` and `itemRowHeight()` to handle it                                        | ⬜ Todo |
| T9.6 | Add a theme `select` item to the General section in `src/settings/buildGlobalSettingsItems.ts`                                                                                                      | ⬜ Todo |
| T9.7 | Render `select` items in `src/components/SettingsItemRow.tsx` as `Label: [value ◀▶]`; handle `←/→` in `src/components/SettingsModal.tsx` to cycle through `options` when a `select` item is focused | ⬜ Todo |

**`select` SettingsItem definition:**

```typescript
| { kind: 'select'; label: string; indent: number; options: readonly string[]; get: () => string; set: (v: string) => void }
```

**`buildGlobalSettingsItems.ts` addition:**

```typescript
{
  kind: 'select', indent: 0,
  label: 'Theme',
  options: THEME_KEYS,
  get: () => settings.general.theme,
  set: (v) => onChange({ general: { theme: v } }),
},
```

---

### Phase 3 — Theme context

| ID   | Task                                                                                                                                                                                              | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.8 | Create `src/base/themeContext.tsx` — `ThemeContext` (default: dark theme), `ThemeProvider` (reads from `SettingsStore`, subscribes to `onSettingsChanged` for live reload), and `useTheme()` hook | ⬜ Todo |
| T9.9 | Wrap root render in `src/components/App.tsx` with `<ThemeProvider>`                                                                                                                               | ⬜ Todo |

**`ThemeProvider` shape:**

```typescript
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState(() =>
    loadTheme(SettingsStore.getInstance().getAppSettings().general.theme)
  );
  useEffect(() =>
    SettingsStore.getInstance().onSettingsChanged(() => {
      setTheme(loadTheme(SettingsStore.getInstance().getAppSettings().general.theme));
    })
  , []);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
```

---

### Phase 4 — Core component migration

| ID    | Task                                                                                                                                                                      | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.10 | Migrate `src/components/Toolbar.tsx`, `TabBar.tsx`, `Separator.tsx`, `Hint.tsx`, `ActionBar.tsx`, `Footer.tsx` — replace hardcoded color strings with `useTheme()` tokens | ⬜ Todo |
| T9.11 | Migrate `src/components/SettingsItemRow.tsx`, `SettingsModal.tsx`, `ImportModal.tsx`, `PromptModal.tsx`                                                                   | ⬜ Todo |

---

### Phase 5 — Secondary panel migration

| ID    | Task                                                                                                                                                              | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.12 | Migrate `src/components/SecondaryPanel/SourcesHintBar.tsx`, `LogPanel.tsx`                                                                                        | ⬜ Todo |
| T9.13 | Migrate `SecondaryPanel/DownloadPanel/StateBadge.tsx`, `PlaybackBar.tsx`, `DownloadPanel.tsx`                                                                     | ⬜ Todo |
| T9.14 | Migrate `DownloadSourceDetail/DetailRow.tsx`, `DiffRow.tsx`, `DiffView.tsx`, `DownloadSourceDetail.tsx`                                                           | ⬜ Todo |
| T9.15 | Migrate `DownloadSourceTree/DownloadSourceTree.tsx`, `MetadataHeader.tsx`, `SourceFileRow.tsx`                                                                    | ⬜ Todo |
| T9.16 | Migrate `MetadataPanel/FieldRow.tsx`, `MetadataCompiledRow.tsx`, `MetadataDetailPanel.tsx`, `MetadataSourceRow.tsx`, `MetadataSourceList.tsx`, `SourcesPanel.tsx` | ⬜ Todo |

---

### Phase 6 — Flow-specific component migration

| ID    | Task                                                                                                                                                                    | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.17 | Migrate toolbar hooks: `src/flows/musicDownloadFlow/toolbar/useExitButton.ts`, `useImportButton.ts`, `useRunAllButton.ts`, `useSettingsButton.ts`                       | ⬜ Todo |
| T9.18 | Migrate `src/flows/musicDownloadFlow/columns/StatusCell.tsx` — refactor `getStatusColor()` to accept `Theme` and return theme tokens instead of hardcoded color strings | ⬜ Todo |

**`getStatusColor` after migration:**

```typescript
function getStatusColor(status: StatusType, theme: Theme): string {
  switch (status) {
    case StatusType.Processing:
      return theme.status.processing;
    case StatusType.PendingUserAction:
      return theme.status.warning;
    case StatusType.Skipped:
      return theme.status.skipped;
    case StatusType.Error:
      return theme.status.error;
    case StatusType.Success:
      return theme.status.success;
    case StatusType.Locked:
      return theme.status.locked;
    case StatusType.Pending:
      return theme.status.pending;
    default:
      return theme.text.secondary;
  }
}
```

---

### Wrap-up

| ID    | Task                                                                                                                            | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T9.19 | Update `docs/projects/README.md` — change `P9 — Color Theme Unification` row from `NOT WRITTEN` to `[p9/tasks.md](p9/tasks.md)` | ⬜ Todo |

---

## How to add a new theme

1. Create `src/assets/themes/<key>.json` with all tokens from the `Theme` interface
2. Add `<key>` to `THEME_KEYS` in `src/base/theme.ts`

No UI code changes required — the `select` options list derives from `THEME_KEYS`.

---

## Verification

| Check                                        | Command / Action                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App starts with dark theme                   | `npm run dev`                                                                                                                                          |
| Theme selector appears                       | Open Settings → General → `Theme: [dark ◀▶]`                                                                                                           |
| Theme cycles and persists                    | Press `→`, `Ctrl+S`, restart — light theme preserved in `config/settings.json`                                                                         |
| No hardcoded Ink colors remain               | `grep -rn 'color="cyan"\|color="white"\|color="gray"\|color="red"\|color="green"\|color="yellow"\|color="blue"\|color="whiteBright"' src/` → 0 results |
| No hardcoded hex colors remain in components | `grep -rn 'color="#a0a0a0"' src/` → 0 results                                                                                                          |
| TypeScript compiles                          | `npx tsc --noEmit` → no new errors                                                                                                                     |
