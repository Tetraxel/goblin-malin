# P29 — Claude as a Fallback & Assistant: Tasks

## Context

Some tracks can't be found by the regular sources (Songlink quota spent, obscure releases, platforms with no API). Claude can search the web and judge "is this the same recording?", so it is wired in as the **ultimate fallback**, and later as an **agent** that acts on the user's behalf.

It runs through the **user's own Claude Code CLI** (`claude -p`, headless) — their account, their plan's usage, no API key and no credentials ever seen by the app. This is a personal-use setup: the CLI is the user's own install, and the app only shells out to it like it does to yt-dlp.

Design rules, shared by every Claude-backed feature:

- **Ask first.** Nothing is sent to Claude (or Songlink) until the user has said yes once. The answer lives in the provider's settings (`enabled` + `consentAsked`); a provider declares the dialog copy with `static consent`.
- **Claude proposes, the app verifies.** Claude only returns URLs/decisions; every URL is re-parsed by the app's own URL parsers, fetched through the platform's real metadata service, and must score ≥ 50% against the primary track (`computeConfidenceScore`) or it is dropped. Nothing Claude says about a track is trusted as data.
- **Last resort, not hot path.** A call takes ~30 s of web research and spends quota. `static lastResort` services only run when a platform is still missing after all regular discovery. Concurrency is capped (2) and a usage-limit error pauses further calls for 10 minutes.
- **Visible.** Work shows as the animated `· ✢ ✳ ✶ ✻ ✽` icon (`StatusIcon: "agent"`), and results are attributed to `claude` in the "found by" lines.

## Done

- `ClaudeClient` (`services/apis/claude-client.ts`) — headless runner: prompt over stdin, JSON-schema `structured_output`, minimal system prompt (~1.4k tokens/call instead of ~50k), error classification (`not-installed` / `not-logged-in` / `quota` / `timeout`), timeout + abort, quota cooldown.
- `ClaudeDiscoveryService` (`metadata-providers/claude/`) — last-resort `DiscoveryMetadataService`; settings: enable (off by default), model (`haiku`/`sonnet`/`opus`/`fable`, default `sonnet`), CLI command/path.
- Consent gate (`utils/discoveryConsent.ts` + `consentBridge`) — one dialog per provider, one at a time, shared by concurrent tasks; applies to Songlink too (now off until allowed).
- Discovery phases in `DownloadTask`: regular services → last-resort services (only for missing platforms, verified).

## Next: Claude as an agent

All of these go through `ClaudeClient` and must follow the rules above (consent, verify, visible). Each needs its own `consent` copy, since "look up a track" and "edit my tags" are different permissions.

### T29.1 — Pick the best source among several candidates

When a platform has several results (e.g. 5 YouTube links) and `autoChooseBestSource` can't decide from confidence alone, give Claude the candidates' metadata (title, channel, duration, view count, upload date) and let it choose the recording to download. Structured output: `{ chosenUri, reason }`; the choice must be one of the offered URIs. Result is shown as a favorited result with a "chosen by Claude" source line; the user can override.

### T29.2 — Detect and fix metadata issues

Per task: send the compiled metadata + all source metadata; ask for a list of detected problems (swapped artist/title, "(Official Video)" suffixes, missing year/ISRC, wrong featured-artist split) and proposed `MetadataOverrides` fixes. Show as a reviewable diff, never auto-apply. Reuses `metadataOverride`.

### T29.3 — Find or create a MusicBrainz release

Given a track with no MusicBrainz match, have Claude search MusicBrainz (and the web) for the right release, or draft a new release's data for the user to submit. Output is a release MBID candidate verified against the MusicBrainz API, or a prefilled "add release" link. Overlaps P27's auto-MB-ID work — build the verification once.

### T29.4 — Agent UX

Shared "Claude is working" surface: the `agent` icon already exists; add a per-task activity line and cancel (wire `ClaudeClient`'s `signal` to the task's abort), plus a usage counter in Settings so the user can see how much they've spent this session.
