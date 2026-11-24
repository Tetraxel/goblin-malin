# Agent tools

> **Generated** from the tool registry by `yarn run agent:tools --write`. Do not edit it by hand: a unit test fails when it is out of date.

Every tool the chat agent can call, declared once with `defineAgentTool` (see [P32](projects/p32/tasks.md)). The MCP server, the CLI's allowlist and this page all read the same registry.

- **Kind**: `read` looks only; `write` changes the user's data through a named method; `confirm` always asks the user first.
- **Locks**: what the call holds while it runs: nothing, the one task it names, or a set it picks itself.
- **Inputs**: a name ending in `?` is optional.

| Tool                    | Kind    | Locks | Undoable | Confirms | Inputs                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------- | ----- | -------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tasks`            | read    | none  | no       | no       | filter?, cursor?                        | Lists the user's tasks (tracks, albums, playlists and groups the user made), 25 per page, with their id, title, artists, state and revision. Use a filter to narrow it; pass the cursor of the previous page for the next one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `get_task`              | read    | none  | no       | no       | taskId                                  | Reads one task in full: the compiled metadata (and which platform each field came from), the user's overrides, what each platform found, the links the user added, the download rows and the MusicBrainz verdict. Its `revision` is what a write must carry.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `get_sources`           | read    | none  | no       | no       | taskId                                  | Lists the download rows of a track: for each its `id` (what select_source and reject_source take), provider, state, whether it is selected or rejected, and its format and quality.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `get_logs`              | read    | none  | no       | no       | taskId, cursor?                         | Reads a page of one task's log (what happened while it was processed), oldest first. The user's name and home folder are hidden.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lookup_url`            | read    | none  | no       | no       | url                                     | Reads a music link through the metadata service that owns it (the same ones the app uses) and returns what it says about the track: title, artists, album, ISRC. Nothing is added to the user's tasks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `search_music`          | read    | none  | no       | no       | query, platforms?, limit?               | Searches music by free text on the streaming platforms the app reads (the search box of each one): a title, an artist, "Title - Artist remix", "Artist live"… Returns tracks with their link, title, artists, album and duration. A result with `upload: true` is a video or upload anyone can post (YouTube videos, SoundCloud): often the only place a remix exists, but also where re-uploads, covers and wrong versions are, so check its title and duration and prefer a result without the flag when both fit. Nothing is added to the user's tasks: to add what you found, pass the links to add_tasks. One request per platform, so search once with a good query and only vary it if the results are poor. |
| `musicbrainz_lookup`    | read    | none  | no       | no       | isrc?, barcode?, url?, title?, artist?  | Asks MusicBrainz (read-only) about a recording by ISRC, a release by barcode, by a streaming link, or by title and artist. Slow: MusicBrainz is rate limited, so ask once, with the most precise key you have.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `wait_for_tasks`        | read    | none  | no       | no       | taskIds, timeoutSec?                    | Waits until the tracks you started (run_metadata, run_download, run_task) have finished, then tells you how each one ended: its state, a verdict (ok, failed, needs_attention, stopped, not_run) with the reasons, and what was downloaded. Waits at most `timeoutSec` (default 120, up to 240); tracks still running then are listed as `stillRunning`, and you can wait again. The user can stop the wait. Waiting costs nothing: use it instead of checking again and again.                                                                                                                                                                                                                                     |
| `review_metadata`       | read    | none  | no       | no       | taskIds                                 | Reads the metadata of several tracks at once, compact, to check it before a download: the compiled title, artists, album, year, ISRC and length, what each platform said, the MusicBrainz verdict, and `flags` for what looks off (title_noise, artists_differ, durations_differ, no_isrc, no_album, no_year, single_platform, musicbrainz_needs_review, no_title, no_artist). A track from an official Spotify link is nearly always fine; a non-official video link (an upload by a channel) is the case to check. Fix what is wrong with set_metadata_override.                                                                                                                                                  |
| `get_settings`          | read    | none  | no       | no       | section?                                | Shows the app's settings as they are now (the defaults with the user's changes): which providers are on, the output folder and format, how many downloads run at once, the MusicBrainz options, this chat's own settings… Use it to find out why something behaves oddly. Secrets (passwords, tokens, keys) are hidden, and so are the user's name and home folder. `section` limits it to one part (general, logs, metadata, download, musicBrainz, agent, collections).                                                                                                                                                                                                                                           |
| `set_metadata_override` | write   | task  | yes      | no       | taskId, revision, patch?, clear?        | Changes the metadata of a track that will be written to its file's tags (title, artists, year…), as if the user had typed it in the Metadata panel. `patch` sets fields, `clear` takes an override back so the platforms' value shows again. Carries the revision you read.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `select_source`         | write   | task  | yes      | no       | taskId, sourceId, revision              | Chooses which download row a track will be saved from. The row must be downloaded and not rejected. Addressed by the row's `id` from get_sources. It does not save anything.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `reject_source`         | write   | task  | yes      | no       | taskId, sourceId, rejected?, revision   | Rejects a download row (the user does not want it; it is never selected, and a download in progress is stopped), or with rejected=false brings it back. Addressed by the row's `id` from get_sources.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `add_user_source`       | write   | task  | yes      | no       | taskId, url, revision                   | Adds a track link the user gave you to a track, as a source (like pasting it onto the track): it is read through the metadata service that owns it and kept even when the task is restarted. Only use a link the user wrote or that lookup_url confirmed, never one you guessed.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `add_tasks`             | write   | none  | yes      | no       | urls                                    | Adds music links to the user's task list, as new tasks (the same as pasting them into the app): a track, album or playlist link of a platform the app reads. Links already in the list or in the archive are skipped and reported. The tasks are only added, not started (run_task, run_metadata and run_download start them). Use it for links the user gave you or that search_music found for what they asked.                                                                                                                                                                                                                                                                                                   |
| `rediscover`            | write   | task  | no       | no       | taskId, revision, provider?             | Looks for the track on the other platforms again: with a `provider`, only that discovery service; without, the whole discovery stage (what the search found is replaced; the user's own links and overrides are kept), except the slow, costly last-resort services, which only the user starts. Slow. Not undoable.                                                                                                                                                                                                                                                                                                                                                                                                |
| `run_metadata`          | write   | none  | no       | no       | taskIds                                 | Runs the metadata part of tracks: for a track that was never run, finds its metadata and the other platforms' versions (nothing is downloaded: it turns DL? off); for a track already run, searches again, keeping what the user typed (overrides, links). It starts them and answers at once: they finish in the background.                                                                                                                                                                                                                                                                                                                                                                                       |
| `run_download`          | confirm | none  | no       | yes      | taskIds                                 | Runs the download part of tracks whose metadata is ready (a track that was never run must go through run_metadata first): searches the download providers and downloads the sources into the app's temporary folder. Always asks the user first. It starts them and answers at once: they finish in the background. It does not save files to the music folder.                                                                                                                                                                                                                                                                                                                                                     |
| `run_task`              | confirm | none  | no       | yes      | taskIds                                 | Runs tracks that were never run, from start to end: their metadata, then their downloads (turns TAG? and DL? on). A track that was run before is refused: use run_metadata or run_download for a part of it (a full restart would erase what the user typed). Always asks the user first. It starts them and answers at once: they finish in the background.                                                                                                                                                                                                                                                                                                                                                        |
| `list_stem_models`      | read    | none  | no       | no       | —                                       | Says whether stem separation is on and installed, the device it runs on, the default model, and the models that are downloaded (only those can be used). Also names the 4-stem models not downloaded yet: downloading one is the user's to do (Settings → Stems).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `get_stems`             | read    | none  | no       | no       | taskId                                  | Reads a track's stems: each separation run (model, state, the stems it made), which run each stem uses, and the stems saved next to the track. `pick_stem` takes a runId from here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `separate_stems`        | confirm | none  | no       | yes      | taskIds, model?                         | Separates tracks into stems (vocals, drums, bass, other…) on the user's computer, with a downloaded model (list_stem_models; the default one when left out). A track needs a downloaded or saved file. Always asks the user first. It queues them and answers at once: they finish in the background, one at a time. It never saves stems to the music folder.                                                                                                                                                                                                                                                                                                                                                      |
| `stop_stems`            | write   | none  | no       | no       | taskId                                  | Stops the separations of a track that are queued or running. What was already separated is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pick_stem`             | write   | task  | yes      | no       | taskId, kind, runId, revision           | Chooses which separation run's file a track uses for one stem (when several models were tried): the one the Stems view shows and that saving takes. Carries the revision you read (get_stems).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `plan_batch`            | read    | none  | no       | no       | summary, changes                        | Plans metadata changes for several tracks at once WITHOUT changing anything: each entry is what set_metadata_override would do. Returns a planId and the diff; apply it with apply_batch, which shows it to the user first. Use it for more than a couple of tracks.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `plan_bulk_override`    | read    | none  | no       | no       | summary?, filter, patch?, titleCleanup? | Plans the same change for every track matching a filter, worked out in code (so a 200-track job costs one call): a `patch` applied to all of them and/or a `titleCleanup` that removes video-site noise like (Official Video) or given text from each title. Changes nothing: returns a planId for apply_batch.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apply_batch`           | confirm | tasks | yes      | yes      | planId                                  | Applies a plan from plan_batch / plan_bulk_override. ALWAYS shows the user the changes first (they can refuse). A plan expires if any of its tracks changed since it was made. The whole batch is one action: /undo reverts all of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `archive_tasks`         | confirm | tasks | no       | yes      | taskIds                                 | Moves tasks (tracks, albums, playlists or groups the user made; the tracks of an album, playlist or group go with it) to the archive (their metadata and sources are kept; the user can restore them from the Archive window). Always asks the user first. Tasks that are being processed are left out, and an id that is no task is reported in `skipped`.                                                                                                                                                                                                                                                                                                                                                         |

## `list_tasks`

Lists the user's tasks (tracks, albums, playlists and groups the user made), 25 per page, with their id, title, artists, state and revision. Use a filter to narrow it; pass the cursor of the previous page for the next one.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "filter": {
            "type": "object",
            "additionalProperties": false,
            "description": "Every given field must match.",
            "properties": {
                "ids": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "maxItems": 200,
                    "description": "Only these task ids."
                },
                "query": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Text found in the title, an artist or the link."
                },
                "state": {
                    "type": "string",
                    "enum": ["pending", "running", "finished", "failed", "stopped"]
                },
                "kind": {
                    "type": "string",
                    "enum": ["track", "collection"]
                },
                "problem": {
                    "type": "string",
                    "enum": ["no_source", "no_metadata", "title_noise", "needs_review", "not_saved"],
                    "description": "no_source: downloads were searched and none is usable; no_metadata: no title yet; title_noise: the title has video-site noise like (Official Video); needs_review: MusicBrainz wants the user to check the release; not_saved: no file saved yet."
                }
            }
        },
        "cursor": {
            "type": "string",
            "maxLength": 12,
            "description": "The `next` value of the previous page."
        }
    }
}
```

Example:

```json
{
    "filter": {
        "problem": "title_noise"
    }
}
```

## `get_task`

Reads one task in full: the compiled metadata (and which platform each field came from), the user's overrides, what each platform found, the links the user added, the download rows and the MusicBrainz verdict. Its `revision` is what a write must carry.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c"
}
```

## `get_sources`

Lists the download rows of a track: for each its `id` (what select_source and reject_source take), provider, state, whether it is selected or rejected, and its format and quality.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c"
}
```

## `get_logs`

Reads a page of one task's log (what happened while it was processed), oldest first. The user's name and home folder are hidden.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "cursor": {
            "type": "string",
            "maxLength": 12,
            "description": "The `next` value of the previous page."
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c"
}
```

## `lookup_url`

Reads a music link through the metadata service that owns it (the same ones the app uses) and returns what it says about the track: title, artists, album, ISRC. Nothing is added to the user's tasks.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["url"],
    "properties": {
        "url": {
            "type": "string",
            "minLength": 8,
            "maxLength": 500
        }
    }
}
```

Example:

```json
{
    "url": "https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG"
}
```

## `search_music`

Searches music by free text on the streaming platforms the app reads (the search box of each one): a title, an artist, "Title - Artist remix", "Artist live"… Returns tracks with their link, title, artists, album and duration. A result with `upload: true` is a video or upload anyone can post (YouTube videos, SoundCloud): often the only place a remix exists, but also where re-uploads, covers and wrong versions are, so check its title and duration and prefer a result without the flag when both fit. Nothing is added to the user's tasks: to add what you found, pass the links to add_tasks. One request per platform, so search once with a good query and only vary it if the results are poor.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["query"],
    "properties": {
        "query": {
            "type": "string",
            "minLength": 2,
            "maxLength": 200,
            "description": "What to search for, as you would type it."
        },
        "platforms": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 40
            },
            "maxItems": 8,
            "description": "Only these platforms (as named in the results). Default: every platform that can search."
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20,
            "description": "Results per platform (default 8)."
        }
    }
}
```

Example:

```json
{
    "query": "Justice Neverender remix",
    "limit": 8
}
```

## `musicbrainz_lookup`

Asks MusicBrainz (read-only) about a recording by ISRC, a release by barcode, by a streaming link, or by title and artist. Slow: MusicBrainz is rate limited, so ask once, with the most precise key you have.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "isrc": {
            "type": "string",
            "maxLength": 20
        },
        "barcode": {
            "type": "string",
            "maxLength": 20
        },
        "url": {
            "type": "string",
            "maxLength": 500,
            "description": "A streaming link of an album, as MusicBrainz lists it."
        },
        "title": {
            "type": "string",
            "maxLength": 200,
            "description": "An album title (a release search), with `artist`."
        },
        "artist": {
            "type": "string",
            "maxLength": 200
        }
    }
}
```

Example:

```json
{
    "isrc": "FRT092400049"
}
```

## `wait_for_tasks`

Waits until the tracks you started (run_metadata, run_download, run_task) have finished, then tells you how each one ended: its state, a verdict (ok, failed, needs_attention, stopped, not_run) with the reasons, and what was downloaded. Waits at most `timeoutSec` (default 120, up to 240); tracks still running then are listed as `stillRunning`, and you can wait again. The user can stop the wait. Waiting costs nothing: use it instead of checking again and again.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 20
        },
        "timeoutSec": {
            "type": "integer",
            "minimum": 5,
            "maximum": 240,
            "description": "Default 120."
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"],
    "timeoutSec": 120
}
```

## `review_metadata`

Reads the metadata of several tracks at once, compact, to check it before a download: the compiled title, artists, album, year, ISRC and length, what each platform said, the MusicBrainz verdict, and `flags` for what looks off (title_noise, artists_differ, durations_differ, no_isrc, no_album, no_year, single_platform, musicbrainz_needs_review, no_title, no_artist). A track from an official Spotify link is nearly always fine; a non-official video link (an upload by a channel) is the case to check. Fix what is wrong with set_metadata_override.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 20
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"]
}
```

## `get_settings`

Shows the app's settings as they are now (the defaults with the user's changes): which providers are on, the output folder and format, how many downloads run at once, the MusicBrainz options, this chat's own settings… Use it to find out why something behaves oddly. Secrets (passwords, tokens, keys) are hidden, and so are the user's name and home folder. `section` limits it to one part (general, logs, metadata, download, musicBrainz, agent, collections).

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "properties": {
        "section": {
            "type": "string",
            "maxLength": 40
        }
    }
}
```

Example:

```json
{
    "section": "download"
}
```

## `set_metadata_override`

Changes the metadata of a track that will be written to its file's tags (title, artists, year…), as if the user had typed it in the Metadata panel. `patch` sets fields, `clear` takes an override back so the platforms' value shows again. Carries the revision you read.

Kind **write**, locks **task**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "revision": {
            "type": "integer",
            "minimum": 0,
            "description": "The `revision` you read from get_task / get_sources (or the one the last write returned)."
        },
        "patch": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "trackName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 300,
                    "description": "The title."
                },
                "artists": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200
                    },
                    "minItems": 1,
                    "maxItems": 30
                },
                "duration": {
                    "type": "integer",
                    "minimum": 1000,
                    "description": "In milliseconds."
                },
                "isrc": {
                    "type": "string",
                    "maxLength": 20,
                    "description": "12 characters, like FRT092400049."
                },
                "year": {
                    "type": "integer",
                    "minimum": 1000,
                    "maximum": 2200
                },
                "trackNumber": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 999
                },
                "bpm": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 400
                },
                "key": {
                    "type": "string",
                    "maxLength": 20
                },
                "genres": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 60
                    },
                    "minItems": 1,
                    "maxItems": 30
                }
            }
        },
        "clear": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["trackName", "artists", "duration", "isrc", "year", "trackNumber", "bpm", "key", "genres"]
            },
            "maxItems": 10
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c",
    "revision": 1234567,
    "patch": {
        "trackName": "Song Title"
    },
    "clear": ["year"]
}
```

## `select_source`

Chooses which download row a track will be saved from. The row must be downloaded and not rejected. Addressed by the row's `id` from get_sources. It does not save anything.

Kind **write**, locks **task**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "sourceId", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "sourceId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 600
        },
        "revision": {
            "type": "integer",
            "minimum": 0,
            "description": "The `revision` you read from get_task / get_sources (or the one the last write returned)."
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c",
    "sourceId": "ytdlp||https://youtu.be/abc",
    "revision": 1234567
}
```

## `reject_source`

Rejects a download row (the user does not want it; it is never selected, and a download in progress is stopped), or with rejected=false brings it back. Addressed by the row's `id` from get_sources.

Kind **write**, locks **task**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "sourceId", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "sourceId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 600
        },
        "rejected": {
            "type": "boolean",
            "description": "Default true."
        },
        "revision": {
            "type": "integer",
            "minimum": 0,
            "description": "The `revision` you read from get_task / get_sources (or the one the last write returned)."
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c",
    "sourceId": "soulseek|someuser|Song.mp3",
    "revision": 1234567
}
```

## `add_user_source`

Adds a track link the user gave you to a track, as a source (like pasting it onto the track): it is read through the metadata service that owns it and kept even when the task is restarted. Only use a link the user wrote or that lookup_url confirmed, never one you guessed.

Kind **write**, locks **task**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "url", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "url": {
            "type": "string",
            "minLength": 8,
            "maxLength": 500
        },
        "revision": {
            "type": "integer",
            "minimum": 0,
            "description": "The `revision` you read from get_task / get_sources (or the one the last write returned)."
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c",
    "url": "https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG",
    "revision": 1234567
}
```

## `add_tasks`

Adds music links to the user's task list, as new tasks (the same as pasting them into the app): a track, album or playlist link of a platform the app reads. Links already in the list or in the archive are skipped and reported. The tasks are only added, not started (run_task, run_metadata and run_download start them). Use it for links the user gave you or that search_music found for what they asked.

Kind **write**, locks **none**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["urls"],
    "properties": {
        "urls": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 8,
                "maxLength": 500
            },
            "minItems": 1,
            "maxItems": 50
        }
    }
}
```

Example:

```json
{
    "urls": ["https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG"]
}
```

## `rediscover`

Looks for the track on the other platforms again: with a `provider`, only that discovery service; without, the whole discovery stage (what the search found is replaced; the user's own links and overrides are kept), except the slow, costly last-resort services, which only the user starts. Slow. Not undoable.

Kind **write**, locks **task**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "revision": {
            "type": "integer",
            "minimum": 0,
            "description": "The `revision` you read from get_task / get_sources (or the one the last write returned)."
        },
        "provider": {
            "type": "string",
            "maxLength": 40,
            "description": "A discovery provider key (musicBrainz, songlink…)."
        }
    }
}
```

Example:

```json
{
    "taskId": "task-1a2b3c",
    "revision": 1234567,
    "provider": "musicBrainz"
}
```

## `run_metadata`

Runs the metadata part of tracks: for a track that was never run, finds its metadata and the other platforms' versions (nothing is downloaded: it turns DL? off); for a track already run, searches again, keeping what the user typed (overrides, links). It starts them and answers at once: they finish in the background.

Kind **write**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 20
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"]
}
```

## `run_download`

Runs the download part of tracks whose metadata is ready (a track that was never run must go through run_metadata first): searches the download providers and downloads the sources into the app's temporary folder. Always asks the user first. It starts them and answers at once: they finish in the background. It does not save files to the music folder.

Kind **confirm**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 20
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"]
}
```

## `run_task`

Runs tracks that were never run, from start to end: their metadata, then their downloads (turns TAG? and DL? on). A track that was run before is refused: use run_metadata or run_download for a part of it (a full restart would erase what the user typed). Always asks the user first. It starts them and answers at once: they finish in the background.

Kind **confirm**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 20
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"]
}
```

## `list_stem_models`

Says whether stem separation is on and installed, the device it runs on, the default model, and the models that are downloaded (only those can be used). Also names the 4-stem models not downloaded yet: downloading one is the user's to do (Settings → Stems).

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "properties": {}
}
```

Example:

```json
{}
```

## `get_stems`

Reads a track's stems: each separation run (model, state, the stems it made), which run each stem uses, and the stems saved next to the track. `pick_stem` takes a runId from here.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        }
    }
}
```

Example:

```json
{
    "taskId": "task:1a2b3c4d5e6f"
}
```

## `separate_stems`

Separates tracks into stems (vocals, drums, bass, other…) on the user's computer, with a downloaded model (list_stem_models; the default one when left out). A track needs a downloaded or saved file. Always asks the user first. It queues them and answers at once: they finish in the background, one at a time. It never saves stems to the music folder.

Kind **confirm**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 10
        },
        "model": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "A model id from list_stem_models."
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task:1a2b3c4d5e6f"],
    "model": "htdemucs_ft.yaml"
}
```

## `stop_stems`

Stops the separations of a track that are queued or running. What was already separated is kept.

Kind **write**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        }
    }
}
```

Example:

```json
{
    "taskId": "task:1a2b3c4d5e6f"
}
```

## `pick_stem`

Chooses which separation run's file a track uses for one stem (when several models were tried): the one the Stems view shows and that saving takes. Carries the revision you read (get_stems).

Kind **write**, locks **task**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskId", "kind", "runId", "revision"],
    "properties": {
        "taskId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
        },
        "kind": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
        },
        "runId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
        },
        "revision": {
            "type": "integer",
            "minimum": 0
        }
    }
}
```

Example:

```json
{
    "taskId": "task:1a2b3c4d5e6f",
    "kind": "vocals",
    "runId": "0f1e2d3c-…",
    "revision": 1234567
}
```

## `plan_batch`

Plans metadata changes for several tracks at once WITHOUT changing anything: each entry is what set_metadata_override would do. Returns a planId and the diff; apply it with apply_batch, which shows it to the user first. Use it for more than a couple of tracks.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["summary", "changes"],
    "properties": {
        "summary": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "What this batch does, in a few words."
        },
        "changes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 200,
            "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["taskId"],
                "properties": {
                    "taskId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200
                    },
                    "patch": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "trackName": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 300,
                                "description": "The title."
                            },
                            "artists": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200
                                },
                                "minItems": 1,
                                "maxItems": 30
                            },
                            "duration": {
                                "type": "integer",
                                "minimum": 1000,
                                "description": "In milliseconds."
                            },
                            "isrc": {
                                "type": "string",
                                "maxLength": 20,
                                "description": "12 characters, like FRT092400049."
                            },
                            "year": {
                                "type": "integer",
                                "minimum": 1000,
                                "maximum": 2200
                            },
                            "trackNumber": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 999
                            },
                            "bpm": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 400
                            },
                            "key": {
                                "type": "string",
                                "maxLength": 20
                            },
                            "genres": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 60
                                },
                                "minItems": 1,
                                "maxItems": 30
                            }
                        }
                    },
                    "clear": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "trackName",
                                "artists",
                                "duration",
                                "isrc",
                                "year",
                                "trackNumber",
                                "bpm",
                                "key",
                                "genres"
                            ]
                        },
                        "maxItems": 10
                    }
                }
            }
        }
    }
}
```

Example:

```json
{
    "summary": "Fix two titles",
    "changes": [
        {
            "taskId": "task-1a2b3c",
            "patch": {
                "trackName": "Song Title"
            }
        }
    ]
}
```

## `plan_bulk_override`

Plans the same change for every track matching a filter, worked out in code (so a 200-track job costs one call): a `patch` applied to all of them and/or a `titleCleanup` that removes video-site noise like (Official Video) or given text from each title. Changes nothing: returns a planId for apply_batch.

Kind **read**, locks **none**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["filter"],
    "properties": {
        "summary": {
            "type": "string",
            "maxLength": 200
        },
        "filter": {
            "type": "object",
            "additionalProperties": false,
            "description": "Which tracks to change; every given field must match.",
            "properties": {
                "ids": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "maxLength": 200
                    },
                    "maxItems": 500
                },
                "query": {
                    "type": "string",
                    "maxLength": 200
                },
                "state": {
                    "type": "string",
                    "enum": ["pending", "running", "finished", "failed", "stopped"]
                },
                "problem": {
                    "type": "string",
                    "enum": ["no_source", "no_metadata", "title_noise", "needs_review", "not_saved"]
                }
            }
        },
        "patch": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "trackName": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 300,
                    "description": "The title."
                },
                "artists": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 200
                    },
                    "minItems": 1,
                    "maxItems": 30
                },
                "duration": {
                    "type": "integer",
                    "minimum": 1000,
                    "description": "In milliseconds."
                },
                "isrc": {
                    "type": "string",
                    "maxLength": 20,
                    "description": "12 characters, like FRT092400049."
                },
                "year": {
                    "type": "integer",
                    "minimum": 1000,
                    "maximum": 2200
                },
                "trackNumber": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 999
                },
                "bpm": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 400
                },
                "key": {
                    "type": "string",
                    "maxLength": 20
                },
                "genres": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 60
                    },
                    "minItems": 1,
                    "maxItems": 30
                }
            }
        },
        "titleCleanup": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "removeNoise": {
                    "type": "boolean",
                    "description": "Remove (Official Video), [Lyrics], (HD)… from the title."
                },
                "remove": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 60
                    },
                    "maxItems": 10,
                    "description": "Literal pieces of text to remove from the title (ignoring case)."
                }
            }
        }
    }
}
```

Example:

```json
{
    "filter": {
        "problem": "title_noise"
    },
    "titleCleanup": {
        "removeNoise": true
    }
}
```

## `apply_batch`

Applies a plan from plan_batch / plan_bulk_override. ALWAYS shows the user the changes first (they can refuse). A plan expires if any of its tracks changed since it was made. The whole batch is one action: /undo reverts all of it.

Kind **confirm**, locks **tasks**, can be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["planId"],
    "properties": {
        "planId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
        }
    }
}
```

Example:

```json
{
    "planId": "plan-1a2b3c4d"
}
```

## `archive_tasks`

Moves tasks (tracks, albums, playlists or groups the user made; the tracks of an album, playlist or group go with it) to the archive (their metadata and sources are kept; the user can restore them from the Archive window). Always asks the user first. Tasks that are being processed are left out, and an id that is no task is reported in `skipped`.

Kind **confirm**, locks **tasks**, cannot be undone.

Input:

```json
{
    "type": "object",
    "additionalProperties": false,
    "required": ["taskIds"],
    "properties": {
        "taskIds": {
            "type": "array",
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
            },
            "minItems": 1,
            "maxItems": 100
        }
    }
}
```

Example:

```json
{
    "taskIds": ["task-1a2b3c", "task-4d5e6f"]
}
```
