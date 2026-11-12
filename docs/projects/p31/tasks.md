# P31 — Add a Link by Hand, and Re-uploads

## Why

An unofficial YouTube re-upload ("Orelsan - Dans ma ville on traine (clip non officiel)", channel "Paul LATOUR") has the wrong artist, and the search — Claude included — found no official track for it. Two fixes: let the user say which track it is, and teach the search that a re-upload may be linked to its official release.

## 1. Add a link by hand

| What                                                                                               | Where                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Ctrl+V` in the **Metadata Sources** list: adds the link(s) in the clipboard to _this_ track       | `useSourceListInput.ts` (`sourceList.addLink`, rebindable), `MetadataPanel.tsx` |
| `Ctrl+V` ("Paste link") on a **platform's cell** (Spotify, YouTube…)                               | `contextualActions.ts`                                                          |
| The link becomes a favorited `[USER]` source of its platform, with the platform's real metadata    | `DownloadTask.addUserSources()`                                                 |
| Anything that cannot be added is explained (album link, unknown platform…), never dropped silently | `utils/addLinkFromClipboard.ts`                                                 |

**Protection.** The link is stored in `TrackDownloadTask.userSources` _before_ anything is fetched; no pipeline step clears it. `applyUserSources()` runs first in every discovery and puts each entry back — so restart (which wipes the groups), a stopped task started again, re-discovery and a saved/loaded session all keep it. A link that cannot be read (network, a platform switched off) stays as an error row to retry with `R`; it is not favorited, so it hides no real metadata. Rejecting a row (`Del`) keeps it, dimmed. A platform covered by a pasted link is no longer "missing", so Claude is not asked about it. A link the search had already found is _adopted_ (protected and favorited) when pasted.

Tests: `tests/unit/userSources.test.ts`.

**Not changed:** the ranking of platform groups. The compiled title/artist still come from the top group; after pasting the official Spotify track of a re-upload, move the Spotify group up (`Shift+↑`) to take its metadata. (Restart also still resets hand-edited fields — see "Open questions".)

## 2. Re-uploads, for Claude

- The prompt (`claudePrompt.ts`) now says: the known track may itself be an unofficial re-upload (the "artist" may be the channel); work out the real artist and title and look for the official release of the same recording; linking a re-upload to its official release is allowed — official Spotify first, then the official YouTube / Topic upload — and **never the other way round**.
- The confidence gate (`confidence.ts`) scored the official track against the _repost's_ wrong artist and dropped it (45 < 50). An artist found as a whole word in the other side's title ("Orelsan - …") now counts as a partial artist match: the same pair scores 60. A cover by someone else still does not.

Tests: `tests/unit/confidence.test.ts`, `tests/unit/claudeDiscovery.test.ts`.

## 3. Follow-ups

- **Pasting works.** Windows Terminal (and most terminals) catch `Ctrl+V` themselves and type the clipboard into the app, so the `Ctrl+V` shortcut never fired: the paste detector opened the import dialog instead. `base/pasteRouter.ts` lets the focused part of the screen claim a pasted link first: the **Metadata Sources list** (any row — compiled, group or source) and a **platform's cell** in the task list (with several tracks selected the import dialog keeps it). The `Ctrl+V` shortcut stays, for terminals that deliver the key.
- **Claude explains itself.** Setting _Explain why Claude chose each link_ (Settings → Metadata → Claude; on by default; a little more output per lookup). Per link Claude writes two texts with two jobs: a one-line `summary` (≤ 90 characters, shown as `why …` under the source when the search details (`E`) are on) and a fuller `explanation` (2–4 sentences, in the log: `Why Claude chose …`). The lookup-level `reasoning` is only asked for when a wanted platform was left out (`Claude left platforms out for …`), so it no longer repeats the explanations. Nothing Claude writes is trusted to be short: the stored summary is capped at 140 characters and the explanation at 1000 (`clipText`), whatever the model sent; a source saved before summaries existed shows the first sentence of its explanation. The setting is part of the cached query. Tests: `tests/unit/claudeExplanations.test.ts`.
- **The MusicBrainz block has its actions.** Under the status: buttons for what can be done now — _Review match…_, _Choose artist…_, _Add to MusicBrainz…_, _Open release ↗_, _↻ Re-check_ — built from the same list (`musicBrainzActionItems`) as the task list's MusicBrainz column, so the keys and the buttons cannot drift. The IDs moved to the bottom (the part that gets cut when the panel is short).
- **Picard comes from the verdict.** `Enter` on the MusicBrainz column (and the _Open in Picard ↗_ button) opens a **release** in MusicBrainz Picard (`/openalbum?id=`) whenever one is known — the confirmed one, else the strongest candidate while the match still needs a review (Picard only loads it) — and the standalone recording (`/opennat?id=`) only when no release is known at all: a release gives the files their album, track numbers and cover art (`musicbrainz/picard.ts`, `picardTargetFor`). The request goes **straight to Picard's local server** (`sendToPicard`: a plain HTTP request to `127.0.0.1:<port>`, default 8000, setting _MusicBrainz Picard port_) — no browser window or tab is opened. When nothing answers (Picard not running, its browser integration off, another port) a dialog says what to start and which port was tried. The discovery anchor no longer carries a Picard address; it only provides the recording (a fallback target) and its web page. It used to depend on the discovery anchor, which is missing when discovery started from a source without an ISRC (a re-upload) — even when the verdict had since found the release. The anchor's own Picard action is skipped when the verdict offers it (same label = same shortcut id).
- **Release pages from MusicBrainz.** A release lists its other pages on MusicBrainz (Spotify, Deezer, Bandcamp, Discogs…, its URL relationships). The review dialog loads them for the candidates (kept on the verdict, so the next review is instant) and shows them under every record as `└─  Spotify  open.spotify.com/album/…`: the service name in its provider color (not underlined), the address underlined only while the pointer is over it, a click opens it (no keys). A matched release has a _Pages ↗…_ action (`X` in the MusicBrainz column) that lists them and opens the pick. Links go to the desktop app when its address is well known — Spotify, Deezer, Tidal (`utils/appLinks.ts`, `toAppUri`, now also used by the Metadata Sources list and the task list) — otherwise the page opens in the browser. Apple Music is left as a web link on purpose: its app address is not reliable across platforms. `musicbrainz/externalLinks.ts` orders them (listen/buy first), drops MusicBrainz' own pages and duplicates, and caps them at 6.
- **The review dialog** is centered like the other question dialogs, shows the release's address as a link (`O` or a click opens it in the browser), and does the same for artists.

## Open questions

- `restart()` still resets `metadataOverride` (fields edited by hand). It is "restart from scratch" by design, but it is user data too.
- Should a pasted link whose track disagrees with the primary one (low confidence) move its group to the top automatically?
