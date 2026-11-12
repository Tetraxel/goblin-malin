import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DiscoveryContext } from "#flows/musicDownloadFlow/discoveryMetadataService";
import type { DiscoveryResult, TrackMetadata, TrackDownloadTask } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-usersources-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

/**
 * Links the user pastes onto a track are data nobody can regenerate. These tests are the promise that they survive
 * every way the track's sources get rebuilt: re-discovery, restart, a stopped task started again, a failed fetch, a
 * service switched off, and a save/load of the session.
 */

const REPOST = "https://youtube.test/repost1";
const OFFICIAL_SPOTIFY = "https://spotify.test/track/sp1";
const OFFICIAL_YOUTUBE = "https://youtube.test/official1";

const meta = (platform: "spotify" | "youtube", id: string, title: string, artist: string, durationMs = 242_000) =>
    ({
        id,
        trackName: title,
        artists: [{ type: "artist", name: artist }],
        duration: durationMs,
        url: `https://${platform}.test/${platform === "spotify" ? "track/" : ""}${id}`,
        uri: `${platform.toUpperCase()}::TRACK::${id}`,
        platform,
        apiProvider: platform,
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

// What each fake platform "knows": url → what getTrackMetadata returns (absent → it throws).
let catalog: Record<string, TrackMetadata>;
let lastResortCalls: (DiscoveryContext | undefined)[];
let spotifyEnabled: boolean;

const PRIMARY = meta("youtube", "repost1", "Orelsan - Dans ma ville on traine (clip non officiel)", "Paul LATOUR");

type Mods = {
    DownloadTask: typeof DownloadTaskType;
    registries: () => {
        metadata: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        discovery: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        download: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
    };
    revive: typeof import("#flows/musicDownloadFlow/utils/reviveTaskDates").reviveTaskDates;
};
let m: Mods;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { DiscoveryMetadataService } = await import("#flows/musicDownloadFlow/discoveryMetadataService");

    const reading = (platform: "spotify" | "youtube", host: string) => {
        return class extends MetadataService {
            static parseUrl(url: string) {
                const u = new URL(url);
                if (u.host !== host) return null;
                const id = u.pathname.split("/").filter(Boolean).pop();
                return id ? { platform, type: "track" as const, id } : null;
            }
            constructor(task: DownloadTaskType, logger: never) {
                super(platform, task, logger);
            }
            async getTrackMetadata(url: string) {
                return catalog[url] ?? Promise.reject(new Error(`unknown ${url}`));
            }
            async searchTrack() {
                return [];
            }
        };
    };
    class FakeLastResort extends DiscoveryMetadataService {
        static readonly lastResort = true;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeLastResort", task, logger);
        }
        async discoverFromUri(_src: TrackMetadata, context?: DiscoveryContext): Promise<DiscoveryResult> {
            lastResortCalls.push(context);
            return { tracks: [] };
        }
    }

    m = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        registries: () => {
            const metadata = new ServiceRegistry<DownloadTaskType, any>();
            metadata
                .register("spotify", reading("spotify", "spotify.test") as never)
                .register("youtube", reading("youtube", "youtube.test") as never);
            const discovery = new ServiceRegistry<DownloadTaskType, any>();
            discovery.register("claude", FakeLastResort as never);
            return { metadata, discovery, download: new ServiceRegistry<DownloadTaskType, any>() };
        },
        revive: (await import("#flows/musicDownloadFlow/utils/reviveTaskDates")).reviveTaskDates,
    };
    // Settings the fakes need: MusicBrainz lookups off (no network), nothing else.
    const { SettingsStore } = await import("#settings/settingsStore");
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
    catalog = {
        [REPOST]: PRIMARY,
        [OFFICIAL_SPOTIFY]: meta("spotify", "sp1", "Dans ma ville on traine", "Orelsan"),
        [OFFICIAL_YOUTUBE]: meta("youtube", "official1", "Dans ma ville on traine", "Orelsan"),
    };
    lastResortCalls = [];
    spotifyEnabled = true;
});

function attributes(over: Partial<TrackDownloadTask> = {}): TrackDownloadTask {
    return {
        kind: "track",
        state: "pending",
        userInput: { type: "url", url: REPOST },
        uri: { platform: "youtube", type: "track", id: "repost1" },
        recognizedServiceKey: "youtube",
        metadataGroups: [],
        metadataOverride: {},
        downloadSources: [],
        toTag: true,
        toDownload: false,
        ...over,
    };
}

async function makeTask(attrs: TrackDownloadTask = attributes()) {
    const { globalLogger } = await import("#base/logger/logger");
    const r = m.registries();
    return new m.DownloadTask({
        id: "t1",
        initialInput: REPOST,
        attributes: attrs,
        logger: globalLogger,
        metadataServiceRegistry: r.metadata,
        discoveryServiceRegistry: r.discovery,
        downloadServiceRegistry: r.download,
        isMetadataServiceEnabled: (key) => key !== "spotify" || spotifyEnabled,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    });
}

/** A task the pipeline has run once: primary fetched, discovery done. */
async function runTask() {
    const task = await makeTask();
    await task.start();
    return task;
}

const group = (task: DownloadTaskType, key: string) =>
    task.getAttributes()?.metadataGroups.find((g) => g.serviceKey === key);
const userResults = (task: DownloadTaskType) =>
    (task.getAttributes()?.metadataGroups ?? []).flatMap((g) => g.results.filter((r) => r.addedByUser));

describe("adding a link to a track", () => {
    test("the link becomes a favorited '[USER]' source of its platform, with the platform's real metadata", async () => {
        const task = await runTask();
        const { added, skipped } = await task.addUserSources([OFFICIAL_SPOTIFY]);

        expect(skipped).toEqual([]);
        expect(added).toHaveLength(1);
        const spotify = group(task, "spotify");
        expect(spotify?.results).toHaveLength(1);
        expect(spotify?.results[0]).toMatchObject({
            addedByUser: true,
            isFavorited: true,
            isRejected: false,
            isPrimaryInput: false,
        });
        expect(spotify?.results[0].metadata.trackName).toBe("Dans ma ville on traine");
        expect(spotify?.results[0].discoverySources[0]).toMatchObject({ discoveredBy: "user", searchKeys: ["url"] });
    });

    test("the link is written to userSources — the durable copy — with its canonical uri", async () => {
        const task = await runTask();
        await task.addUserSources([`  ${OFFICIAL_SPOTIFY}  `]);
        expect(task.getAttributes()?.userSources).toEqual([
            { url: OFFICIAL_SPOTIFY, uri: "SPOTIFY::TRACK::sp1", addedAt: expect.any(String) },
        ]);
    });

    test("a second link on the same platform joins the first; the newest is the group's favorite", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_YOUTUBE]);
        const youtube = group(task, "youtube")!;
        expect(youtube.results).toHaveLength(2); // the repost (primary) and the official one
        const [first, second] = [...youtube.results].sort((a, b) => a.rank - b.rank);
        expect(first.addedByUser).toBe(true);
        expect(first.isFavorited).toBe(true);
        expect(second.isPrimaryInput).toBe(true);
        expect(second.isFavorited).toBe(false);
    });

    test("pasting a link the search had already found adopts it: protected and favorited", async () => {
        const task = await runTask();
        const found = catalog[OFFICIAL_SPOTIFY];
        task.updateAttributes({
            metadataGroups: [
                ...task.getAttributes()!.metadataGroups,
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 1,
                    results: [
                        {
                            metadata: found,
                            isPrimaryInput: false,
                            isFavorited: false,
                            isRejected: false,
                            rank: 0,
                            confidence: 55,
                            discoverySources: [
                                { discoveredBy: "claude", fromUri: PRIMARY.uri!, searchKeys: ["trackName"] },
                            ],
                        },
                    ],
                },
            ],
        });

        await task.addUserSources([OFFICIAL_SPOTIFY]);

        const spotify = group(task, "spotify")!;
        expect(spotify.results).toHaveLength(1);
        expect(spotify.results[0]).toMatchObject({ addedByUser: true, isFavorited: true });
        // It keeps how it was found, and also says the user put it there.
        expect(spotify.results[0].discoverySources.map((s) => s.discoveredBy)).toEqual(["claude", "user"]);

        await task.restart(); // and now it survives a restart like any pasted link
        expect(userResults(task)).toHaveLength(1);
    });

    test("adding the same link again changes nothing", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        await task.addUserSources([OFFICIAL_SPOTIFY, OFFICIAL_SPOTIFY]);
        expect(task.getAttributes()?.userSources).toHaveLength(1);
        expect(group(task, "spotify")?.results).toHaveLength(1);
    });

    test("a link no service reads is reported and NOT stored; the track's own link is refused", async () => {
        const task = await runTask();
        const { added, skipped } = await task.addUserSources(["https://deezer.example/track/9", REPOST, "not a link"]);
        expect(added).toEqual([]);
        expect(skipped.map((s) => s.reason)).toEqual([
            "not a track link Goblin Malin can read",
            "that is this track's own link",
            "not a track link Goblin Malin can read",
        ]);
        expect(task.getAttributes()?.userSources ?? []).toEqual([]);
    });

    test("a platform the user covered is no longer 'missing': the last-resort service is not asked about it", async () => {
        const task = await runTask();
        expect(lastResortCalls).toEqual([{ wantedPlatforms: ["spotify"] }]); // before: spotify was missing

        lastResortCalls = [];
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        await task.startMetadataDiscovering();
        expect(lastResortCalls).toEqual([]);
    });
});

describe("the link is never lost", () => {
    test("re-discovery keeps it (and does not duplicate it), while dropping what the search had found", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        await task.startMetadataDiscovering();
        await task.startMetadataDiscovering();

        expect(userResults(task)).toHaveLength(1);
        expect(group(task, "spotify")?.results).toHaveLength(1);
        expect(task.getAttributes()?.userSources).toHaveLength(1);
    });

    test("RESTART wipes the groups — and the link comes back from userSources", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY, OFFICIAL_YOUTUBE]);

        await task.restart();

        expect(task.getAttributes()?.userSources).toHaveLength(2);
        expect(
            userResults(task)
                .map((r) => r.metadata.uri)
                .sort()
        ).toEqual(["SPOTIFY::TRACK::sp1", "YOUTUBE::TRACK::official1"]);
        expect(group(task, "spotify")?.results[0]).toMatchObject({ addedByUser: true, isFavorited: true });
        // The original link is still the primary input, like before.
        expect(group(task, "youtube")?.results.some((r) => r.isPrimaryInput)).toBe(true);
    });

    test("a STOPPED task started again clears its groups — the link comes back", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        task.updateAttributes({ state: "stopped" });

        await task.start();

        expect(task.getAttributes()?.userSources).toHaveLength(1);
        expect(group(task, "spotify")?.results[0]).toMatchObject({ addedByUser: true });
    });

    test("re-fetching the primary metadata keeps it", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        await task.startPrimaryMetadataFetching();
        expect(userResults(task)).toHaveLength(1);
    });

    test("saving and loading the session keeps both the entry and the result", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);

        const saved = JSON.parse(JSON.stringify(task.getAttributes()));
        const revived = m.revive(saved) as TrackDownloadTask;
        const loaded = await makeTask(revived);

        expect(loaded.getAttributes()?.userSources).toEqual(task.getAttributes()?.userSources);
        expect(userResults(loaded)).toHaveLength(1);

        await loaded.restart(); // and a restart of the loaded task still restores it
        expect(userResults(loaded)).toHaveLength(1);
    });

    test("a session saved before this feature (no userSources) loads as before", async () => {
        const task = await makeTask(attributes());
        expect(task.getAttributes()?.userSources).toBeUndefined();
        await task.start();
        expect(group(task, "youtube")?.results).toHaveLength(1);
    });
});

describe("a link that cannot be read right now is still kept", () => {
    test("a failed fetch keeps the entry and shows a row to retry — not favorited, so it hides nothing", async () => {
        delete catalog[OFFICIAL_SPOTIFY]; // Spotify is down / the link is private
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);

        expect(task.getAttributes()?.userSources).toHaveLength(1);
        const row = group(task, "spotify")?.results[0];
        expect(row).toMatchObject({ addedByUser: true, fetchState: "error", isFavorited: false });
        expect(row?.fetchError).toContain("unknown");
        expect(row?.metadata.url).toBe(OFFICIAL_SPOTIFY);
    });

    test("once it can be read, the next discovery fills the row in and favorites it", async () => {
        const real = catalog[OFFICIAL_SPOTIFY];
        delete catalog[OFFICIAL_SPOTIFY];
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);

        catalog[OFFICIAL_SPOTIFY] = real;
        await task.startMetadataDiscovering();

        const spotify = group(task, "spotify")!;
        expect(spotify.results).toHaveLength(1);
        expect(spotify.results[0]).toMatchObject({ addedByUser: true, isFavorited: true });
        expect(spotify.results[0].fetchState).toBeUndefined();
        expect(spotify.results[0].metadata.trackName).toBe("Dans ma ville on traine");
    });

    test("[R] Refetch on the failed row works like on any other", async () => {
        const real = catalog[OFFICIAL_SPOTIFY];
        delete catalog[OFFICIAL_SPOTIFY];
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);

        catalog[OFFICIAL_SPOTIFY] = real;
        const gi = task.getAttributes()!.metadataGroups.findIndex((g) => g.serviceKey === "spotify");
        await task.refetchResult(gi, 0);
        expect(group(task, "spotify")?.results[0].metadata.trackName).toBe("Dans ma ville on traine");
    });

    test("a platform switched off in Settings keeps the link as a row that says so", async () => {
        spotifyEnabled = false;
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        const row = group(task, "spotify")?.results[0];
        expect(row).toMatchObject({ addedByUser: true, fetchState: "error" });
        expect(row?.fetchError).toContain("switched off");
        expect(task.getAttributes()?.userSources).toHaveLength(1);

        spotifyEnabled = true; // switched back on: it fills in at the next discovery
        await task.startMetadataDiscovering();
        expect(group(task, "spotify")?.results[0].fetchState).toBeUndefined();
    });

    test("rejecting the row (the user's 'no') is respected across a restart's re-apply of the entry", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        const groups = task.getAttributes()!.metadataGroups.map((g) => ({
            ...g,
            results: g.results.map((r) => (r.addedByUser ? { ...r, isRejected: true, isFavorited: false } : r)),
        }));
        task.updateAttributes({ metadataGroups: groups });

        await task.startMetadataDiscovering(); // keeps the row as the user left it
        expect(userResults(task)[0]).toMatchObject({ isRejected: true, isFavorited: false });
        expect(task.getAttributes()?.userSources).toHaveLength(1); // rejected is not deleted
    });
});

describe("deleting a link the user added (Del)", () => {
    test("the row and its durable entry are both gone, and a restart does not bring it back", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY]);
        expect(task.removeUserSource("SPOTIFY::TRACK::sp1")).toBe(true);

        expect(userResults(task)).toEqual([]);
        expect(task.getAttributes()?.userSources).toEqual([]);
        // The group the link had created goes with it, not an empty "Spotify (0 results)".
        expect(group(task, "spotify")).toBeUndefined();

        await task.restart();
        expect(userResults(task)).toEqual([]);
        expect(group(task, "spotify")?.results ?? []).toHaveLength(0);
    });

    test("a rejected row is deleted too, and only the targeted link goes", async () => {
        const task = await runTask();
        await task.addUserSources([OFFICIAL_SPOTIFY, OFFICIAL_YOUTUBE]);
        task.updateAttributes({
            metadataGroups: task.getAttributes()!.metadataGroups.map((g) => ({
                ...g,
                results: g.results.map((r) => (r.addedByUser ? { ...r, isRejected: true } : r)),
            })),
        });

        expect(task.removeUserSource("SPOTIFY::TRACK::sp1")).toBe(true);

        expect(task.getAttributes()?.userSources?.map((s) => s.url)).toEqual([OFFICIAL_YOUTUBE]);
        expect(userResults(task)).toHaveLength(1);
        // The YouTube group still has the repost (primary) next to the remaining user row.
        expect(group(task, "youtube")?.results).toHaveLength(2);
    });

    test("only a link the user added can be deleted: the primary and the search's own results cannot", async () => {
        const task = await runTask();
        expect(task.removeUserSource(PRIMARY.uri!)).toBe(false);
        expect(task.removeUserSource("SPOTIFY::TRACK::unknown")).toBe(false);
        expect(group(task, "youtube")?.results.some((r) => r.isPrimaryInput)).toBe(true);
    });
});

describe("pasting a link (Ctrl+V)", () => {
    let notices: { title: string; message: string }[];

    beforeEach(async () => {
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        notices = [];
        dialogBridge.setConfirmOpener((dialog, resolve) => {
            notices.push({ title: dialog.title, message: dialog.message });
            resolve(0);
        });
    });
    afterEach(async () => {
        const { dialogBridge } = await import("#base/bridges/dialogBridge");
        dialogBridge.setConfirmOpener(null);
    });

    const paste = async (task: DownloadTaskType, text: string) =>
        (await import("#flows/musicDownloadFlow/utils/addLinkFromClipboard")).addLinkFromClipboard(task, text);

    test("a track link in the clipboard is added silently", async () => {
        const task = await runTask();
        await paste(task, `look at this: ${OFFICIAL_SPOTIFY}`);
        expect(notices).toEqual([]);
        expect(userResults(task)).toHaveLength(1);
    });

    test("several links at once are all added", async () => {
        const task = await runTask();
        await paste(task, `${OFFICIAL_SPOTIFY}\n${OFFICIAL_YOUTUBE}`);
        expect(task.getAttributes()?.userSources).toHaveLength(2);
        expect(notices).toEqual([]);
    });

    test("no link at all: it says so, and nothing is added", async () => {
        const task = await runTask();
        await paste(task, "just some words");
        expect(notices.map((n) => n.title)).toEqual(["No link in the clipboard"]);
        await paste(task, "   ");
        expect(notices[1].title).toBe("Clipboard is empty");
        expect(task.getAttributes()?.userSources ?? []).toEqual([]);
    });

    test("an album link is refused with a reason that tells what to paste instead", async () => {
        const task = await runTask();
        await paste(task, "https://open.spotify.com/album/abc123");
        expect(notices).toHaveLength(1);
        expect(notices[0].title).toBe("Nothing was added");
        expect(task.getAttributes()?.userSources ?? []).toEqual([]);
    });

    test("one good link and one bad: the good one is added AND the bad one is explained", async () => {
        const task = await runTask();
        await paste(task, `${OFFICIAL_SPOTIFY} https://deezer.example/track/9`);
        expect(userResults(task)).toHaveLength(1);
        expect(notices[0].title).toBe("Some links were not added");
        expect(notices[0].message).toContain("deezer.example");
    });
});
