/**
 * A small fake world for the MusicBrainz tests: a streaming service that knows one album, and a MusicBrainz that
 * knows whatever a test says it knows. Import this module FIRST in a test file: it points the app's data folder at
 * a temp dir before any app code is loaded (everything else here is imported dynamically for the same reason).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { ParsedUrl } from "#base/urlParser";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";
import type { ProviderAlbum } from "#flows/musicDownloadFlow/musicbrainz/types";

export const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-mb-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

export const ALBUM_URL = "https://open.spotify.com/album/alb1";
export const ARTIST_URL = "https://open.spotify.com/artist/aurora";
export const BARCODE = "5059000000017";

export const PRIMARY = {
    id: "t1",
    isrc: "FRT092400049",
    trackName: "Night Drive",
    trackNumber: 1,
    artists: [{ type: "artist", name: "Aurora Vale", url: ARTIST_URL }],
    // What a Spotify TRACK carries: the simplified album — no barcode.
    album: {
        id: "alb1",
        albumName: "Night Drive",
        albumType: "album",
        totalTracks: 9,
        releaseDate: "2024-03-01",
        url: ALBUM_URL,
        uri: "spotify:album:alb1",
        artists: [{ type: "artist", name: "Aurora Vale", url: ARTIST_URL }],
    },
    duration: 200_000,
    url: "https://open.spotify.com/track/t1",
    uri: "SPOTIFY::TRACK::t1",
    platform: "spotify",
    apiProvider: "spotify",
    fetchedAt: new Date(),
    type: "track",
} as unknown as TrackMetadata;

/** A release as the real MusicBrainz API returns it. */
export const MB_RELEASE = {
    id: "rel-1",
    title: "Night Drive",
    barcode: BARCODE,
    "artist-credit": [
        {
            name: "Aurora Vale",
            joinphrase: "",
            artist: { id: "art-1", name: "Aurora Vale", "sort-name": "Aurora Vale" },
        },
    ],
    media: [{ "track-count": 9 }],
    "release-group": { id: "rg-1" },
};

export const albumWithTracks = (): ProviderAlbum => ({
    id: "alb1",
    name: "Night Drive",
    url: ALBUM_URL,
    barcode: BARCODE,
    trackCount: 2,
    artists: [{ name: "Aurora Vale", url: ARTIST_URL }],
    tracks: [
        {
            id: "t1",
            name: "Night Drive",
            number: 1,
            discNumber: 1,
            durationMs: 200_000,
            isrc: "FRT092400049",
            artists: [{ name: "Aurora Vale", url: ARTIST_URL }],
        },
        {
            id: "t2",
            name: "Day Drive",
            number: 2,
            discNumber: 1,
            durationMs: 180_000,
            isrc: "ISRC2",
            artists: [{ name: "Aurora Vale", url: ARTIST_URL }],
        },
    ],
});

/** What the fake world currently is. Tests change these; `resetWorld()` puts them back. */
export const world = {
    /** What the streaming service says about the whole album (null: it cannot; Error: it fails). */
    albumDetails: null as ProviderAlbum | null | Error,
    albumDetailsCalls: 0,
    /** The service has the album-details capability at all. */
    withAlbumDetails: true,
    /** MusicBrainz knows the album: its streaming link, and its tracks' ISRCs. */
    mbKnowsTheAlbum: true,
    /** ISRCs MusicBrainz knows even when it does not know the album. */
    mbIsrcs: new Set<string>(),
    /** What a barcode search returns. */
    barcodeHits: [] as unknown[],
    /** The releases of the matched release's release group, as the real API returns them (browse). */
    groupReleases: [] as unknown[],
    /** Every request the fake MusicBrainz API got. */
    apiCalls: [] as string[],
};

type Registry = import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
type Loaded = {
    DownloadTask: typeof DownloadTaskType;
    registries: () => { metadata: Registry; discovery: Registry; download: Registry };
    MusicBrainzClient: typeof import("#flows/musicDownloadFlow/services/apis/musicbrainz-client").MusicBrainzClient;
    clearMemory: () => void;
    SettingsStore: typeof import("#settings/settingsStore").SettingsStore;
};

let loaded: Loaded | undefined;

export async function loadWorld(): Promise<Loaded> {
    if (loaded) return loaded;
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");

    const parseUrl = (url: string): ParsedUrl | null => {
        // Like the real service: only its own site (links are now recognized by the services that read them).
        if (!url.includes("open.spotify.com/")) return null;
        if (url.includes("/album/")) return { platform: "spotify", type: "album", id: "alb1" };
        if (url.includes("/track/")) return { platform: "spotify", type: "track", id: "t1" };
        return null;
    };
    class FakeSpotify extends MetadataService {
        static parseUrl = parseUrl;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSpotify", task, logger);
        }
        async getTrackMetadata() {
            return PRIMARY;
        }
        async searchTrack() {
            return [];
        }
        async getAlbumDetails() {
            world.albumDetailsCalls++;
            if (world.albumDetails instanceof Error) throw world.albumDetails;
            return world.albumDetails;
        }
    }
    // The same service, minus the capability: the checks have to go on with what the track itself carried.
    class FakeSpotifyNoAlbum extends MetadataService {
        static parseUrl = parseUrl;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSpotifyNoAlbum", task, logger);
        }
        async getTrackMetadata() {
            return PRIMARY;
        }
        async searchTrack() {
            return [];
        }
    }

    loaded = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        registries: () => {
            const metadata = new ServiceRegistry<DownloadTaskType, any>();
            metadata.register("spotify", (world.withAlbumDetails ? FakeSpotify : FakeSpotifyNoAlbum) as never);
            return {
                metadata,
                discovery: new ServiceRegistry<DownloadTaskType, any>(),
                download: new ServiceRegistry<DownloadTaskType, any>(),
            };
        },
        MusicBrainzClient: (await import("#flows/musicDownloadFlow/services/apis/musicbrainz-client"))
            .MusicBrainzClient,
        clearMemory: (await import("#flows/musicDownloadFlow/musicbrainz/identityCheck")).clearMusicBrainzMemory,
        SettingsStore: (await import("#settings/settingsStore")).SettingsStore,
    };
    return loaded;
}

/** A MusicBrainz API (the shape of what the real one answers) driven by `world`. */
async function installFakeMusicBrainz(): Promise<void> {
    const { MusicBrainzApiError } = await import("musicbrainz-api");
    const { MusicBrainzClient } = await loadWorld();
    const notFound = () => new MusicBrainzApiError("not found", { status: 404, statusText: "Not Found" });
    MusicBrainzClient.setApiForTesting({
        lookupUrl: async (resource: string) => {
            world.apiCalls.push(`url:${resource}`);
            if (resource.includes("/album/") && world.mbKnowsTheAlbum) {
                return {
                    id: "u",
                    resource,
                    relations: [{ type: "x", release: { id: "rel-1", title: "Night Drive" } }],
                };
            }
            if (resource.includes("/artist/")) {
                return {
                    id: "u",
                    resource,
                    relations: [{ type: "x", artist: { id: "art-1", name: "Aurora Vale", "sort-name": "A" } }],
                };
            }
            throw notFound();
        },
        lookup: async (entity: string, id: string, inc: string[] = []) => {
            world.apiCalls.push(`lookup:${entity}`);
            // With `recordings` the real API lists each medium's tracks: "trk-1" is the track of rec-1.
            if (entity === "release" && inc.includes("recordings")) {
                return {
                    ...MB_RELEASE,
                    id,
                    media: [{ "track-count": 9, tracks: [{ id: "trk-1", recording: { id: "rec-1" } }] }],
                };
            }
            if (entity === "release") return { ...MB_RELEASE, id };
            if (entity === "isrc") {
                const known = world.mbKnowsTheAlbum || world.mbIsrcs.has(id);
                return {
                    isrc: id,
                    recordings: known ? [{ id: "rec-1", title: "Night Drive", "artist-credit": [] }] : [],
                };
            }
            if (entity === "recording")
                return { id, title: "Night Drive", "artist-credit": [], releases: [MB_RELEASE] };
            throw new Error(`unexpected lookup ${entity}`);
        },
        browse: async (entity: string, q: Record<string, unknown>) => {
            world.apiCalls.push(`browse:${entity}:${String(q["release-group"] ?? "")}`);
            return { releases: world.groupReleases };
        },
        search: async (_entity: string, q: { query: string }) => {
            world.apiCalls.push(`search:${q.query}`);
            return { releases: q.query.includes("barcode:") ? world.barcodeHits : [], artists: [] };
        },
    } as never);
}

/** Back to the starting world: a streaming service that knows the album, a MusicBrainz that knows it too. */
export async function resetWorld(): Promise<void> {
    const w = await loadWorld();
    world.albumDetails = {
        id: "alb1",
        name: "Night Drive",
        url: ALBUM_URL,
        barcode: BARCODE,
        trackCount: 9,
        artists: [{ name: "Aurora Vale", url: ARTIST_URL }],
        tracks: [],
    };
    world.albumDetailsCalls = 0;
    world.withAlbumDetails = true;
    world.mbKnowsTheAlbum = true;
    world.mbIsrcs = new Set();
    world.barcodeHits = [];
    world.groupReleases = [];
    world.apiCalls = [];
    w.clearMemory();
    w.SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: true } });
    await installFakeMusicBrainz();
}

export async function endWorld(): Promise<void> {
    (await loadWorld()).MusicBrainzClient.setApiForTesting(null);
}

export async function makeTask(id = "t1"): Promise<DownloadTaskType> {
    const w = await loadWorld();
    const { globalLogger } = await import("#base/logger/logger");
    const r = w.registries();
    return new w.DownloadTask({
        id,
        initialInput: PRIMARY.url,
        attributes: {
            kind: "track",
            state: "running",
            userInput: { type: "url", url: PRIMARY.url },
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [
                        {
                            metadata: PRIMARY,
                            isPrimaryInput: true,
                            isFavorited: false,
                            isRejected: false,
                            rank: 0,
                            discoverySources: [],
                        },
                    ],
                },
            ],
            metadataOverride: {},
            downloadSources: [],
            toTag: true,
            toDownload: false,
        },
        logger: globalLogger,
        metadataServiceRegistry: r.metadata,
        discoveryServiceRegistry: r.discovery,
        downloadServiceRegistry: r.download,
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    });
}

export function removeDataDir(): void {
    fs.rmSync(dataDir, { recursive: true, force: true });
}
