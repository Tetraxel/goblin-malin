# Codebase Audit

This directory contains a snapshot audit of the codebase as it stands at the start of active development. The goal is to give developers a clear map of how the system currently works before making structural changes.

## Documents

| File | Description |
|------|-------------|
| [01-tech-stack.md](01-tech-stack.md) | Runtime, build system, and all dependencies |
| [02-project-structure.md](02-project-structure.md) | File and folder layout with role of each file |
| [03-core-architecture.md](03-core-architecture.md) | Base classes: ServiceBase, Task, FlowBase, FlowOrchestrator |
| [04-music-download-flow.md](04-music-download-flow.md) | The only active flow: data pipeline from import to download |
| [05-ui-components.md](05-ui-components.md) | App entry, Ink components, columns, and focus management |

## Current State Summary

The project is a working proof-of-concept for one specific pipeline:

> Import Spotify URLs from `inputs.txt` → fetch Spotify metadata → search the corresponding YouTube track → download via yt-dlp to `downloads/`

The codebase is architected well beyond this POC scope. There is a full service registry pattern, a task/flow orchestration engine, and a multi-panel terminal UI — all wired up to support multiple metadata providers and download backends in the future.

**What is active today:**
- 2 metadata services: Spotify, YouTube Music
- 1 download service: yt-dlp
- 1 flow: MusicDownloadFlow
- Tasks loaded from `inputs.txt` (one URL per line)

**What is implemented but disabled** (commented out in registries):
- MusicBrainz metadata provider
- Song.link aggregator
- Soulseek download provider
