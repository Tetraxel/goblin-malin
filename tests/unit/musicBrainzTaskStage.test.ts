// Must stay the first import: it points the app's data folder at a temp dir before any app code loads.
import {
    loadWorld,
    makeTask,
    removeDataDir,
    resetWorld,
    endWorld,
    world,
    BARCODE,
    PRIMARY,
} from "./helpers/musicBrainzWorld";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

let w: Awaited<ReturnType<typeof loadWorld>>;

beforeAll(async () => {
    w = await loadWorld();
});
afterAll(() => removeDataDir());
beforeEach(() => resetWorld());
afterEach(() => endWorld());

describe("the MusicBrainz stage of discovery", () => {
    test("discovery ends with the track's MusicBrainz release, found with the barcode the album details gave", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();

        const identity = task.getAttributes()?.musicBrainzIdentity;
        expect(identity?.verdict).toBe("matched");
        expect(identity?.release?.id).toBe("rel-1");
        expect(world.albumDetailsCalls).toBe(1);
        expect(world.apiCalls.some((c) => c.startsWith("url:https://open.spotify.com/album/alb1"))).toBe(true);
        expect(world.apiCalls.some((c) => c.includes(`barcode:"${BARCODE}"`))).toBe(true);
    });

    test("the IDs reach the tags: all four, once the release is matched (clears MD-03)", async () => {
        const { computeCompiledMetadata } = await import("#flows/musicDownloadFlow/utils/compiledMetadata");
        const { compiledMetadataToTags } = await import("#flows/musicDownloadFlow/utils/compiledMetadataToTags");
        const { getSaveSettings } = await import("#flows/musicDownloadFlow/saveSettings");
        const task = await makeTask();
        await task.startMetadataDiscovering();

        const attrs = task.getAttributes()!;
        const compiled = computeCompiledMetadata(
            attrs.metadataGroups,
            attrs.metadataOverride,
            attrs.musicBrainzIdentity
        );
        expect(getSaveSettings().includeMusicBrainzTags).toBe(true);
        expect(
            compiledMetadataToTags(compiled, { includeMusicBrainzTags: getSaveSettings().includeMusicBrainzTags })
        ).toMatchObject({
            musicBrainzAlbumId: "rel-1",
            musicBrainzReleaseGroupId: "rg-1",
            musicBrainzTrackId: "rec-1",
            musicBrainzArtistId: "art-1",
            // What Picard calls "Release Artist MBID" and "Track MBID".
            musicBrainzAlbumArtistIds: ["art-1"],
            musicBrainzReleaseTrackId: "trk-1",
        });
    });

    test("saving follows the track's own MusicBrainz switch, and Settings when it has none", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const attrs = () => task.getAttributes()!;
        const tagsFor = async () => {
            const { computeCompiledMetadata } = await import("#flows/musicDownloadFlow/utils/compiledMetadata");
            const { compiledMetadataToTags } = await import("#flows/musicDownloadFlow/utils/compiledMetadataToTags");
            const { getSaveSettings } = await import("#flows/musicDownloadFlow/saveSettings");
            const compiled = computeCompiledMetadata(
                attrs().metadataGroups,
                attrs().metadataOverride,
                attrs().musicBrainzIdentity
            );
            return compiledMetadataToTags(compiled, {
                includeMusicBrainzTags: attrs().includeMusicBrainzTags ?? getSaveSettings().includeMusicBrainzTags,
            });
        };

        expect((await tagsFor()).musicBrainzAlbumId).toBe("rel-1");
        task.setIncludeMusicBrainzTags(false);
        expect(attrs().includeMusicBrainzTags).toBe(false);
        expect((await tagsFor()).musicBrainzAlbumId).toBeUndefined();
        task.setIncludeMusicBrainzTags(true);
        w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { includeTags: false } });
        expect((await tagsFor()).musicBrainzAlbumId).toBe("rel-1");
        w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { includeTags: true } });
    });

    test("switched off in Settings: no lookups, no verdict", async () => {
        w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
        const task = await makeTask();
        await task.startMetadataDiscovering();
        expect(task.getAttributes()?.musicBrainzIdentity).toBeUndefined();
        expect(world.apiCalls).toEqual([]);
    });

    test("a service that cannot give the album: the checks go on, the missing barcode keeps it from 'not found'", async () => {
        world.withAlbumDetails = false;
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const identity = task.getAttributes()?.musicBrainzIdentity;
        expect(identity?.verdict).toBe("unknown");
        expect(identity?.checks.find((c) => c.name === "barcode")?.status).toBe("skipped");
    });

    test("a service that fails reading the album does not fail the track", async () => {
        world.albumDetails = new Error("Spotify is down");
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        expect(task.getAttributes()?.musicBrainzIdentity?.verdict).toBe("unknown");
    });

    test("nothing in MusicBrainz and every check answered → notFound (what makes 'Add to MusicBrainz' available)", async () => {
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        expect(task.getAttributes()?.musicBrainzIdentity?.verdict).toBe("notFound");
    });

    test("re-checking keeps what the user decided", async () => {
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const chosen = { id: "rel-chosen", title: "Night Drive", artists: [] };
        await task.checkMusicBrainz({ user: { chosenRelease: chosen, rejectedReleaseIds: [], artistChoices: {} } });
        expect(task.getAttributes()?.musicBrainzIdentity).toMatchObject({ verdict: "matched", decidedBy: "user" });

        await task.checkMusicBrainz({ force: true });
        expect(task.getAttributes()?.musicBrainzIdentity?.release?.id).toBe("rel-chosen");
    });

    test("a track with no album information yields 'unknown' without asking MusicBrainz anything", async () => {
        const task = await makeTask();
        const groups = task.getAttributes()!.metadataGroups;
        task.updateAttributes({
            metadataGroups: groups.map((g) => ({
                ...g,
                results: g.results.map((r) => ({
                    ...r,
                    metadata: { ...r.metadata, album: undefined } as TrackMetadata,
                })),
            })),
        });
        const identity = await task.checkMusicBrainz();
        expect(identity?.verdict).toBe("unknown");
        expect(world.apiCalls).toEqual([]);
    });
});

describe("when the sources change after the check (the re-check call-to-action)", () => {
    const staleness = async (task: Awaited<ReturnType<typeof makeTask>>) => {
        const { computeCompiledMetadata } = await import("#flows/musicDownloadFlow/utils/compiledMetadata");
        const { isMusicBrainzVerdictStale } = await import("#flows/musicDownloadFlow/musicbrainz/inputKey");
        const attrs = task.getAttributes()!;
        const compiled = computeCompiledMetadata(
            attrs.metadataGroups,
            attrs.metadataOverride,
            attrs.musicBrainzIdentity
        );
        return isMusicBrainzVerdictStale(attrs.musicBrainzIdentity, compiled);
    };

    // A second source for the same track: another platform, with a different album and a title of its own.
    const addOtherSource = (task: Awaited<ReturnType<typeof makeTask>>, over: Partial<TrackMetadata> = {}) => {
        const attrs = task.getAttributes()!;
        task.updateAttributes({
            metadataGroups: [
                ...attrs.metadataGroups.map((g) => ({ ...g, rank: g.rank + 1 })),
                {
                    platform: "youtube",
                    serviceKey: "youtube",
                    rank: 0,
                    results: [
                        {
                            metadata: {
                                ...PRIMARY,
                                id: "y1",
                                uri: "YOUTUBE::TRACK::y1",
                                platform: "youtube",
                                trackName: "Another title",
                                album: {
                                    ...PRIMARY.album,
                                    id: "alb2",
                                    url: "https://open.spotify.com/album/alb2",
                                    albumName: "Other album",
                                },
                                ...over,
                            } as TrackMetadata,
                            isPrimaryInput: false,
                            isFavorited: false,
                            isRejected: false,
                            rank: 0,
                            discoverySources: [],
                        },
                    ],
                },
            ],
        });
    };

    test("a fresh verdict is not stale; it carries the fingerprint of what it was made from", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        expect(task.getAttributes()?.musicBrainzIdentity?.inputKey).toBeTruthy();
        expect(await staleness(task)).toBe(false);
    });

    test("a new source that changes the compiled metadata makes it stale — and a re-check makes it fresh again", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();

        addOtherSource(task); // ranked first: its title and album now win
        expect(await staleness(task)).toBe(true);

        await task.checkMusicBrainz();
        expect(await staleness(task)).toBe(false);
    });

    test("reordering the sources so that other values win makes it stale", async () => {
        const task = await makeTask();
        addOtherSource(task); // the new source is first
        await task.checkMusicBrainz();
        expect(await staleness(task)).toBe(false);

        const attrs = task.getAttributes()!;
        task.updateAttributes({
            metadataGroups: attrs.metadataGroups.map((g) => ({ ...g, rank: g.serviceKey === "youtube" ? 5 : 0 })),
        });
        expect(await staleness(task)).toBe(true);
    });

    test("editing a field by hand (the title) makes it stale", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        task.updateAttributes({ metadataOverride: { trackName: "Night Drive (radio edit)" } });
        expect(await staleness(task)).toBe(true);
    });

    test("changes that do not alter the compiled metadata (a favorite, a rejected duplicate) do not", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const attrs = task.getAttributes()!;
        task.updateAttributes({
            metadataGroups: attrs.metadataGroups.map((g) => ({
                ...g,
                results: g.results.map((r) => ({ ...r, isFavorited: true })),
            })),
        });
        expect(await staleness(task)).toBe(false);
    });

    test("a verdict saved before fingerprints existed is not called stale", async () => {
        const { isMusicBrainzVerdictStale } = await import("#flows/musicDownloadFlow/musicbrainz/inputKey");
        const compiled = { trackName: "x", artists: [], isrc: undefined, album: undefined };
        expect(isMusicBrainzVerdictStale({}, compiled)).toBe(false);
        expect(isMusicBrainzVerdictStale(undefined, compiled)).toBe(false);
    });

    test("there is something to check only with a title and an album", async () => {
        const { canCheckMusicBrainz } = await import("#flows/musicDownloadFlow/musicbrainz/inputKey");
        const album = PRIMARY.album;
        expect(canCheckMusicBrainz({ trackName: "x", album })).toBe(true);
        expect(canCheckMusicBrainz({ trackName: "x", album: undefined })).toBe(false);
        expect(canCheckMusicBrainz({ trackName: "", album })).toBe(false);
    });
});

describe("what the user decided is never lost", () => {
    const chosen = { id: "rel-chosen", title: "Night Drive", artists: [] };
    // What importing the link stores, so that a restart can fetch the track again.
    const recognized = (task: Awaited<ReturnType<typeof makeTask>>) =>
        task.updateAttributes({
            recognizedServiceKey: "spotify",
            uri: { platform: "spotify", type: "track", id: "t1" },
        });

    test("a restart keeps the user's decisions, and the next check applies them again", async () => {
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        await task.checkMusicBrainz({ user: { chosenRelease: chosen, rejectedReleaseIds: [], artistChoices: {} } });

        recognized(task);
        await task.restart();

        expect(task.getAttributes()?.musicBrainzIdentity).toMatchObject({
            verdict: "matched",
            decidedBy: "user",
            userChoice: { chosenRelease: { id: "rel-chosen" } },
        });
    });

    test("a restart of a track the user decided nothing about starts from nothing", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        expect(task.getAttributes()?.musicBrainzIdentity).toBeDefined();
        w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
        recognized(task);
        await task.restart();
        expect(task.getAttributes()?.musicBrainzIdentity).toBeUndefined();
    });

    test("checks of one track run one after the other: a slow one cannot overwrite a decision made meanwhile", async () => {
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        // The first check's first question takes a while to be answered.
        const api = (w.MusicBrainzClient as unknown as { api: { lookupUrl: (...a: unknown[]) => Promise<unknown> } })
            .api;
        const lookupUrl = api.lookupUrl;
        let delayed = false;
        api.lookupUrl = async (...args: unknown[]) => {
            if (!delayed) {
                delayed = true;
                await new Promise((r) => setTimeout(r, 60));
            }
            return lookupUrl(...args);
        };

        let seenByTheSecond: unknown;
        const first = task.checkMusicBrainz({
            force: true,
            decide: (c) => ({ ...c, artistChoices: { ...c.artistChoices, "name:aurora vale": "art-1" } }),
        });
        const second = task.checkMusicBrainz({
            decide: (c) => {
                seenByTheSecond = c;
                return { ...c, chosenRelease: chosen };
            },
        });
        await Promise.all([first, second]);

        // The second saw what the first decided, and kept it.
        expect(seenByTheSecond).toMatchObject({ artistChoices: { "name:aurora vale": "art-1" } });
        expect(task.getAttributes()?.musicBrainzIdentity?.userChoice).toMatchObject({
            chosenRelease: { id: "rel-chosen" },
            artistChoices: { "name:aurora vale": "art-1" },
        });
    });

    test("a release picked for another album is kept, but not applied to this one", async () => {
        world.mbKnowsTheAlbum = false;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const choice = {
            chosenRelease: chosen,
            rejectedReleaseIds: ["rel-no"],
            artistChoices: {},
            albumKey: "open.spotify.com/album/another-album",
        };
        await task.checkMusicBrainz({ user: choice });
        const identity = task.getAttributes()?.musicBrainzIdentity;
        expect(identity?.release).toBeUndefined();
        expect(identity?.verdict).not.toBe("matched");
        expect(identity?.userChoice).toMatchObject({
            chosenRelease: { id: "rel-chosen" },
            rejectedReleaseIds: ["rel-no"],
        });
    });
});

describe("the IDs written into a file", () => {
    type Saver = { musicBrainzIdentityForSave: (a: unknown) => Promise<{ release?: { id: string } } | undefined> };

    test("a verdict made from other sources is checked again before its IDs are used", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        task.updateAttributes({ metadataOverride: { trackName: "Night Drive (radio edit)" } });
        const staleKey = task.getAttributes()?.musicBrainzIdentity?.inputKey;

        const identity = await (task as unknown as Saver).musicBrainzIdentityForSave(task.getAttributes());

        // Checked again (the album-level answers may come from the shared memory): the verdict now carries the new key.
        expect(task.getAttributes()?.musicBrainzIdentity?.inputKey).not.toBe(staleKey);
        expect(identity?.release?.id).toBe("rel-1");
        const { isMusicBrainzVerdictStale } = await import("#flows/musicDownloadFlow/musicbrainz/inputKey");
        const { computeCompiledMetadata } = await import("#flows/musicDownloadFlow/utils/compiledMetadata");
        const attrs = task.getAttributes()!;
        expect(
            isMusicBrainzVerdictStale(
                attrs.musicBrainzIdentity,
                computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride)
            )
        ).toBe(false);
    });

    test("with the lookups switched off a verdict made from other sources is left out", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        task.updateAttributes({ metadataOverride: { trackName: "Night Drive (radio edit)" } });
        w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
        expect(await (task as unknown as Saver).musicBrainzIdentityForSave(task.getAttributes())).toBeUndefined();
    });

    test("a verdict still in step with the sources is used as it is, without asking again", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const before = world.apiCalls.length;
        const identity = await (task as unknown as Saver).musicBrainzIdentityForSave(task.getAttributes());
        expect(identity?.release?.id).toBe("rel-1");
        expect(world.apiCalls.length).toBe(before);
    });
});
