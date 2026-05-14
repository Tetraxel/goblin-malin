# P10 — Setup Wizard per Provider

## Goal

Each provider that requires API credentials needs a guided setup experience. Currently, missing env vars surface as a bare single-line `PromptModal` with no instructions. This leaves the user with no context on how to obtain the value, forces them to provide keys one at a time, and gives them no path to disable the provider if they don't meet the prerequisites (e.g. Spotify Premium requirement).

This project adds a **Setup Wizard** system:

- Providers declare a structured wizard config: rich instructions (paragraphs, notes, numbered steps, clickable links), and form fields pre-filled from `.env`
- The wizard opens from a **"⚙ Setup Wizard"** action button in the Settings provider section
- It also opens **automatically** when a service tries to use a missing env var (replacing the bare PromptModal)
- The wizard can disable the provider from within (for cases where the user doesn't meet prerequisites)

---

## Wizard config structure (`src/base/setupWizard.ts`)

```typescript
export type WizardContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "note"; text: string } // renders as a [!NOTE] admonition box
  | { type: "orderedList"; items: WizardListItem[] };

export type WizardListItem =
  | { type: "text"; text: string }
  | { type: "link"; text: string; url: string }; // Enter to open in default browser

export interface WizardField {
  envVar: string; // e.g. 'SPOTIFY_CLIENT_ID'
  label: string; // e.g. 'CLIENT_ID'  (shown left of the input)
  hint?: string; // placeholder when empty
  required?: boolean; // default true — blocks submit if empty
}

export interface SetupWizardConfig {
  title: string; // e.g. 'Spotify Setup Wizard'
  providerKey?: string; // used to color the modal border via providerDisplayRegistry
  description: WizardContentBlock[];
  fields: WizardField[];
}
```

---

## Modal layout

```
╭── Spotify Setup Wizard ──────────────────────────────────╮
│  ┌────────────────────────────────────────────────────┐  │
│  │ [!NOTE] You need a Premium Account to use this API.│  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  Steps to get the Spotify API credentials:               │
│  1. ▶ Log in to the Spotify Developer Dashboard          │
│  2.   Click "Create app"                                 │
│  3.   Get the CLIENT_ID and CLIENT_SECRET                │
│                                                           │
│  CLIENT_ID      [b94c59cdcd                    ]         │
│  CLIENT_SECRET  [                              ]  ← focus│
│                                                           │
│  ↑↓ Navigate  Enter Open/Edit  ^S Submit  Esc Cancel  D Disable │
╰───────────────────────────────────────────────────────────╯
```

Interactive items (links and form fields) are navigated with `↑ ↓`. Links show `▶` when focused; pressing `Enter` opens the URL. Fields show a `TextInput` when focused. `Ctrl+S` saves all fields to `.env` and `process.env`. `Esc` cancels without saving. `D` disables the provider's `enabled` setting and closes.

---

## Tasks

### T10.1 — Define SetupWizardConfig types

**File:** `src/base/setupWizard.ts` (new)

Define `WizardContentBlock`, `WizardListItem`, `WizardField`, `SetupWizardConfig` as shown above. Types only, no runtime logic.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.2 — Extend ProviderConstructorLike

**File:** `src/base/providerSettings.ts`

Add `setupWizard?: SetupWizardConfig` as an optional static property to the `ProviderConstructorLike` interface so `buildFlowSettingsItems` and `providerItems()` can read it without casting.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.3 — Implement wizard config in SpotifyService

**File:** `src/flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService.ts`

Add `static readonly setupWizard: SetupWizardConfig`:

```typescript
static readonly setupWizard: SetupWizardConfig = {
  title: 'Spotify Setup Wizard',
  providerKey: 'spotify',
  description: [
    {
      type: 'note',
      text: 'Known limitation: You need a Premium Account to access the Spotify API.',
    },
    {
      type: 'orderedList',
      items: [
        { type: 'link', text: 'Log in to the Spotify Developer Dashboard', url: 'https://developer.spotify.com/dashboard' },
        { type: 'text', text: 'Click "Create app"' },
        { type: 'text', text: 'Copy the CLIENT_ID and CLIENT_SECRET from the app page' },
      ],
    },
  ],
  fields: [
    { envVar: 'SPOTIFY_CLIENT_ID',     label: 'CLIENT_ID',     hint: 'e.g. b94c59cdcd…' },
    { envVar: 'SPOTIFY_CLIENT_SECRET', label: 'CLIENT_SECRET', hint: 'e.g. fa5a8a70ab…' },
  ],
};
```

Also update `getClient()` to use `this.env.getVariablesWithWizard(SpotifyService.setupWizard)` instead of two separate `getVariable` calls:

```typescript
private async getClient(): Promise<SpotifyApi> {
  return this.runExclusive('init', async () => {
    if (!SpotifyService.client) {
      const vars = await this.env.getVariablesWithWizard(SpotifyService.setupWizard);
      SpotifyService.client = SpotifyApi.withClientCredentials(
        vars['SPOTIFY_CLIENT_ID'],
        vars['SPOTIFY_CLIENT_SECRET'],
      );
    }
    return SpotifyService.client;
  });
}
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.4 — Link-opening utility

**File:** `src/utils/openUrl.ts` (new)

```typescript
import { exec } from "child_process";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.5 — Extend TaskPrompt with SetupWizard prompt type

**File:** `src/base/task/task-prompt.ts`

Add `SetupWizard` to the `PromptType` enum.

Extend the `UserPrompt` type to include a `SetupWizard` variant:

```typescript
| {
    type: PromptType.SetupWizard;
    config: SetupWizardConfig;
    resolve: (values: Record<string, string>) => void;
    reject: (reason?: unknown) => void;
  }
```

Add `askSetupWizard(config: SetupWizardConfig): Promise<Record<string, string>>` method on `TaskPrompt` — creates a pending `SetupWizard` prompt and awaits resolution into a `Record<envVar, value>`.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.6 — Add getVariablesWithWizard to Env

**File:** `src/base/env.ts`

```typescript
public async getVariablesWithWizard(
  config: SetupWizardConfig,
): Promise<Record<string, string>> {
  const missing = config.fields.filter(f => !process.env[f.envVar]);

  if (missing.length > 0) {
    const values = await this.task.getPrompt().askSetupWizard(config);
    for (const [key, value] of Object.entries(values)) {
      await this.saveToEnvFile(key, value);
      process.env[key] = value;
    }
    return values;
  }

  return Object.fromEntries(
    config.fields.map(f => [f.envVar, process.env[f.envVar]!]),
  );
}
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.7 — Create useActiveWizardPrompt hook

**File:** `src/hooks/useActiveWizardPrompt.ts` (new)

Mirror the pattern of the existing `useActivePrompt` hook but filtered to `PromptType.SetupWizard` tasks. Returns `{ task, prompt, config }` when an active wizard prompt exists, or `{ task: null, prompt: null, config: null }`.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.8 — Extend FocusContext for wizard state

**Files:**

- `src/hooks/useFocusManager.ts`
- `src/contexts/FocusContext.tsx`

Add `'setupWizardModal'` to the `FocusableWindow` union.

Add to `FocusState`:

```typescript
wizardConfig: SetupWizardConfig | null;
```

Add to `FocusContext` interface and implementation:

```typescript
openWizard: (config: SetupWizardConfig) => void;
// implementation: sets wizardConfig + calls switchWindow('setupWizardModal')
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.9 — Create SetupWizardModal component

**File:** `src/components/SetupWizardModal/SetupWizardModal.tsx` (new)

**Props:** `{ tasks: Task[], terminalHeight: number, terminalWidth: number }`

**When to show:** The component is always mounted in AppInner. It renders when **either**:

- `focusState.activeWindow === 'setupWizardModal'` — settings button trigger; config from `focusState.wizardConfig`
- An active `PromptType.SetupWizard` task prompt exists — auto-trigger; config from task prompt via `useActiveWizardPrompt(tasks)`

On mount when either source becomes active, call `switchWindow('setupWizardModal')`.

**Internal state:**

- `focusedIndex: number` — index within the list of interactive items (links + fields)
- `fieldValues: Record<string, string>` — mutable map initialized from `process.env` for each field
- `editingField: string | null` — `envVar` of the field currently being edited

**Interactive item list:** Derived from the config — ordered as they appear in the layout:

1. Link items from `orderedList` blocks (in order)
2. Form fields (in order)

**Content rendering helpers:**

- `note` block → bordered `Box` with amber/yellow border color, `[!NOTE]` prefix label, text body
- `paragraph` block → plain `Text` with top margin
- `orderedList` block → numbered list; link items show `▶` prefix when focused, plain `>` otherwise
- Form fields → `Label  [value or placeholder]` rows; when `editingField === field.envVar`, render a `TextInput`

**Keyboard handling (only when `focusState.activeWindow === 'setupWizardModal'`):**

| Key                 | Action                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `↑ / ↓`             | Move `focusedIndex` through interactive items                                                                        |
| `Enter` on link     | `openUrl(item.url)`                                                                                                  |
| `Enter` on field    | Set `editingField` to that field's `envVar`                                                                          |
| `Esc` while editing | Clear `editingField` (keep typed value)                                                                              |
| `Ctrl+S`            | Validate required fields → save all to `.env`/`process.env` → resolve task prompt (if auto-trigger) → `switchBack()` |
| `Esc` (not editing) | Reject task prompt (if auto-trigger) → `switchBack()` without saving                                                 |
| `D`                 | Set `enabled: false` for provider via a passed-in `onDisable?` callback → `switchBack()`                             |

**Footer hints:** `↑↓ Navigate  Enter Open/Edit  ^S Submit  Esc Cancel  D Disable`

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.10 — Add Setup Wizard action button in settings per provider

**File:** `src/flows/musicDownloadFlow/buildFlowSettingsItems.ts`

Update `providerItems()` to accept a new `onOpenWizard: (config: SetupWizardConfig) => void` parameter (passed through from `buildFlowSettingsItems`). After the `providerHeader` item, if `ctor.setupWizard` is defined, push:

```typescript
items.push({
  kind: "action",
  indent: 4,
  label: "⚙  Setup Wizard",
  run: () => onOpenWizard(ctor.setupWizard!),
});
```

Update `buildFlowSettingsItems()` signature to accept `onOpenWizard` and thread it to both the metadata and download provider loops.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.11 — Wire onOpenWizard in SettingsModal

**File:** `src/components/SettingsModal/SettingsModal.tsx`

Read `openWizard` from `useFocusContext()`. Pass it as `onOpenWizard` to `buildFlowSettingsItems(...)`.

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.12 — Register SetupWizardModal in AppInner

**File:** `src/components/AppInner.tsx`

Add alongside the existing modals:

```tsx
<SetupWizardModal
  tasks={tasks}
  terminalHeight={terminalHeight}
  terminalWidth={terminalWidth}
/>
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T10.13 — Update docs/projects/README.md

**File:** `docs/projects/README.md`

Change the `P10` row from `NOT WRITTEN` to `[p10/tasks.md](p10/tasks.md)`.

| Status  |
| ------- |
| ⬜ Todo |

---

## Verification

| Check                      | Action                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Settings button appears    | `npm run dev` → Settings → Spotify provider → "⚙ Setup Wizard" action visible           |
| Wizard opens from settings | Press Enter on "⚙ Setup Wizard" → modal appears with note, steps, fields                |
| Fields pre-filled          | If `.env` already has `SPOTIFY_CLIENT_ID`, its value is shown in the input              |
| Links are navigable        | `↓` to a link item → `▶` prefix → `Enter` → browser opens the URL                       |
| Submit saves to .env       | Fill fields → `Ctrl+S` → `.env` updated → modal closes                                  |
| Auto-trigger works         | Delete `.env` entries → import a Spotify URL → wizard opens instead of bare PromptModal |
| Cancel is safe             | `Esc` in wizard → closes without writing to `.env`                                      |
| Disable closes with action | `D` in wizard → provider disabled in settings → wizard closes                           |
| TypeScript compiles        | `npx tsc --noEmit` → no new errors                                                      |
