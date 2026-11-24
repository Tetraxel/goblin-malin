/**
 * Regenerates the small hand-made fixtures (`collection-failures`, `user-data`) from code, so their sessions stay
 * readable and valid when the session format moves: `yarn tsx scripts/tui-test/fixtures/buildFixtures.ts`.
 *
 * - `collection-failures`: a playlist of five tracks that ended in different ways (finished, failed, stopped).
 * - `user-data`: tracks that hold what the user typed by hand (a pasted link, a metadata override), which no restart
 *   or re-run may throw away (see "User data is never rebuilt away" in CLAUDE.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(here, "collection-import", "settings.json"), "utf-8")) as unknown;

type Json = Record<string, unknown>;

const trackUrl = (platform: "spotify" | "deezer", id: string): string =>
    platform === "spotify" ? `https://open.spotify.com/track/${id}` : `https://www.deezer.com/track/${id}`;

const track = (
    id: string,
    parent: string | undefined,
    extra: Json,
    status: Json,
    platform: "spotify" | "deezer" = "spotify"
): Json => ({
    id: `task:${id}`,
    initialInput: trackUrl(platform, id),
    attributes: {
        kind: "track",
        uri: { platform, type: "track", id },
        recognizedServiceKey: platform,
        ...(parent ? { parentTaskId: parent } : {}),
        userInput: { type: "url", url: trackUrl(platform, id) },
        metadataGroups: [],
        metadataOverride: {},
        downloadSources: [],
        toTag: true,
        toDownload: false,
        ...extra,
    },
    status: { timeTracking: false, startTime: null, ...status },
    prompt: null,
});

const noStatus = { type: "noStatus", message: "No status" };

function write(name: string, tasks: Json[]): void {
    const dir = path.join(here, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(base, null, 4));
    const session = {
        id: `session-${name}`,
        name,
        createdAt: "2026-07-01T12:00:00.000Z",
        updatedAt: "2026-07-01T12:00:00.000Z",
        renamed: true,
        tasks,
    };
    fs.writeFileSync(
        path.join(dir, "sessions.json"),
        JSON.stringify({ version: 1, lastSessionId: session.id, sessions: [session] })
    );
}

// A playlist whose tracks ended differently: the parent's counts and the rows' states must agree.
const ids = ["FAILTRK0001", "FAILTRK0002", "FAILTRK0003", "FAILTRK0004", "FAILTRK0005"];
write("collection-failures", [
    {
        id: "task:playlistF",
        initialInput: "https://open.spotify.com/playlist/plstfail000000000001",
        attributes: {
            kind: "collection",
            collectionKind: "playlist",
            state: "finished",
            userInput: { type: "url", url: "https://open.spotify.com/playlist/plstfail000000000001" },
            recognizedServiceKey: "spotify",
            name: "Mixed results",
            ownerName: "bob",
            totalCount: ids.length,
            childTaskIds: ids.map((id) => `task:${id}`),
            collapsed: false,
            toTag: true,
            toDownload: false,
        },
        status: { type: "success", message: `${ids.length} tracks`, timeTracking: false, startTime: null },
        prompt: null,
    },
    track(ids[0]!, "task:playlistF", { state: "finished" }, { type: "success", message: "Done" }),
    track(ids[1]!, "task:playlistF", { state: "failed" }, { type: "error", message: "Metadata fetch failed" }),
    track(ids[2]!, "task:playlistF", { state: "finished" }, { type: "success", message: "Done" }),
    track(ids[3]!, "task:playlistF", { state: "failed" }, { type: "error", message: "Download failed" }),
    track(ids[4]!, "task:playlistF", { state: "stopped" }, noStatus),
]);

// Tracks that hold the user's own edits. Deezer, so that running them needs no Spotify setup (and no network: see the scenario).
const pasted = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
write("user-data", [
    track(
        "2001",
        undefined,
        {
            state: "stopped",
            metadataOverride: { trackName: "My Own Title", year: 1999 },
            userSources: [{ url: pasted, uri: "YOUTUBE::TRACK::dQw4w9WgXcQ", addedAt: "2026-07-01T12:00:00.000Z" }],
        },
        noStatus,
        "deezer"
    ),
    track("2002", undefined, { state: "pending" }, noStatus, "deezer"),
]);

console.log("fixtures written");
