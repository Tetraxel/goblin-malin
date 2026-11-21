// Builds the data folder the README screenshots are taken on: scripts/tui-test/fixtures/showcase/
//
//   node scripts/screenshots/make-showcase-fixture.mjs
//
// The real app fills a session with what the providers answered; here the answers are written by hand (well-known
// tracks, plausible ids) so a screenshot shows every column filled, several platforms per track, download
// candidates of both providers and a saved file, without a network, an account or a download.
// Nothing in it is fetched again: every task is "finished" and the cache is off.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "tui-test", "fixtures", "showcase");
mkdirSync(root, { recursive: true });
// Files the session points at. The app only checks that they exist (a saved file that is gone says "FILE NOT FOUND").
const filesDir = join(root, "files");
mkdirSync(filesDir, { recursive: true });
const touch = (name) => {
    const path = join(filesDir, name);
    writeFileSync(path, "");
    return path;
};

const NOW = "2026-11-18T21:04:00.000Z";
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** A stable, random-looking id of `len` characters from a seed (a tiny LCG: the same fixture on every run). */
function sid(seed, len = 22) {
    let x = (seed * 2654435761 + 12345) >>> 0;
    let out = "";
    for (let i = 0; i < len; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        out += B62[(x >>> 8) % 62];
    }
    return out;
}

/** Tracks: [artist, title, album, year, durationMs, ISRC, platformsPresent] */
const TRACKS = [
    ["Daft Punk", "Harder, Better, Faster, Stronger", "Discovery", "2001", 224000, "GBDUW0000059", "sp yt dz am sc td"],
    ["Justice", "D.A.N.C.E.", "†", "2007", 243000, undefined, "sp yt dz am sc td"],
    ["Kavinsky", "Nightcall", "OutRun", "2013", 258000, undefined, "sp yt dz am td"],
    ["Burial", "Archangel", "Untrue", "2007", 238000, undefined, "sp yt dz am sc td"],
    ["Caribou", "Can't Do Without You", "Our Love", "2014", 243000, undefined, "sp yt dz am"],
    ["Jungle", "Busy Earnin'", "Jungle", "2014", 206000, undefined, "sp yt dz am sc td"],
    ["Röyksopp", "What Else Is There?", "The Understanding", "2005", 315000, undefined, "sp yt dz am"],
    ["Mount Kimbie", "Maybes", "Crooks & Lovers", "2010", 255000, undefined, "sp yt dz sc"],
    ["Bonobo", "Kerala", "Migration", "2017", 223000, undefined, "sp yt dz am td"],
    ["Aphex Twin", "Windowlicker", "Windowlicker", "1999", 367000, undefined, "sp yt dz am sc"],
    ["Four Tet", "Baby", "There Is Love in You", "2010", 246000, undefined, "sp yt dz am"],
    ["Floating Points", "Silhouettes (I, II & III)", "Elaenia", "2015", 332000, undefined, "sp yt dz"],
];

const PLATFORMS = {
    sp: { platform: "spotify", key: "spotify", api: "spotify", label: "SPOTIFY", rank: 0 },
    yt: { platform: "youtube", key: "youtube", api: "youtube", label: "YOUTUBE", rank: 1 },
    sc: { platform: "soundcloud", key: "soundcloud", api: "soundcloud", label: "SOUNDCLOUD", rank: 2 },
    dz: { platform: "deezer", key: "deezer", api: "deezer", label: "DEEZER", rank: 3 },
    am: { platform: "appleMusic", key: "appleMusic", api: "itunes", label: "APPLEMUSIC", rank: 4 },
    td: { platform: "tidal", key: "tidal", api: "tidal", label: "TIDAL", rank: 5 },
};

const urlFor = (p, id) =>
    ({
        spotify: `https://open.spotify.com/track/${id}`,
        youtube: `https://www.youtube.com/watch?v=${id}`,
        soundcloud: `https://soundcloud.com/${id}`,
        deezer: `https://www.deezer.com/track/${id}`,
        appleMusic: `https://music.apple.com/us/song/${id}`,
        tidal: `https://tidal.com/track/${id}`,
    })[p];

function trackMeta(t, p, n) {
    const [artist, title, album, year, duration, isrc] = t;
    const def = PLATFORMS[p];
    const seed = n * 101 + def.rank * 17 + 3; // one seed per track and platform: no two ids alike
    const id =
        p === "yt"
            ? sid(seed, 11)
            : p === "dz" || p === "td" || p === "am"
              ? String(1000000000 + ((seed * 7919) % 900000000))
              : sid(seed);
    const isSpotify = p === "sp";
    const dur = duration + (isSpotify ? 0 : (n % 3) * 1000 - 1000);
    return {
        id,
        ...(isSpotify || p === "dz" ? (isrc ? { isrc } : {}) : {}),
        trackName: p === "yt" ? `${title}` : title,
        artists: [{ type: "artist", name: artist }],
        duration: dur,
        url: urlFor(def.platform, id),
        uri: `${def.label}::TRACK::${id}`,
        ...(isSpotify ? { nativeAppUriDesktop: `spotify:track:${id}` } : {}),
        ...(p !== "yt" && p !== "sc"
            ? {
                  trackNumber: (n % 9) + 1,
                  album: {
                      id: `al${id}`,
                      albumType: "album",
                      albumName: album,
                      totalTracks: 12 + (n % 5),
                      releaseDate: `${year}-01-01`,
                      url: urlFor(def.platform, id),
                      uri: `${def.label}::ALBUM::al${id}`,
                      artists: [{ type: "artist", name: artist }],
                  },
              }
            : {}),
        platform: def.platform,
        apiProvider: def.api,
        fetchedAt: NOW,
        type: "track",
    };
}

function group(t, p, n, primary) {
    const def = PLATFORMS[p];
    const metadata = trackMeta(t, p, n);
    const confidence = [100, 96, 93, 91, 88][(n + def.rank) % 5];
    return {
        platform: def.platform,
        serviceKey: def.key,
        rank: def.rank,
        results: [
            {
                metadata,
                isPrimaryInput: primary,
                isFavorited: false,
                isRejected: false,
                rank: 0,
                ...(primary ? {} : { confidence }),
                discoverySources: primary
                    ? []
                    : [
                          {
                              discoveredBy: def.key,
                              fromUri: `SPOTIFY::TRACK::${trackMeta(t, "sp", n).id}`,
                              searchKeys: [t[5] && (p === "dz" || p === "sp") ? "isrc" : "trackName+artistName"],
                          },
                      ],
            },
        ],
    };
}

const fileInfo = (over) => ({
    format: "flac",
    sizeBytes: 0,
    durationMs: 0,
    embeddedTags: {},
    codec: "flac",
    ...over,
});

function downloadRows(t, n, { saved }) {
    const dur = t[4];
    const yt = trackMeta(t, "yt", n);
    const sp = trackMeta(t, "sp", n);
    const q = (text) => [{ label: "Search", value: text }];
    const rows = [
        {
            state: "downloaded",
            provider: "ytdlp",
            track: yt,
            localFile: {
                state: "found",
                path: touch(`${t[0]} - ${t[1]} (yt-dlp).flac`),
                name: `${t[0]} - ${t[1]}`,
                extension: "flac",
            },
            downloadedAt: NOW,
            selected: !saved,
            rowKey: `yt-${n}`,
            fileInfo: fileInfo({
                sizeBytes: Math.round(dur * 20),
                durationMs: dur,
                bitrateKbps: 640,
                provenance: "lossy-transcode",
                sourceCodec: "Opus",
            }),
            progress: 100,
            query: [{ label: "Link", value: yt.url }],
        },
    ];
    if (saved) {
        rows.push(
            {
                state: "downloaded",
                provider: "soulseek",
                track: sp,
                localFile: {
                    state: "found",
                    path: touch(`${t[0]} - ${t[1]} (soulseek).flac`),
                    name: `${t[0]} - ${t[1]}`,
                    extension: "flac",
                },
                downloadedAt: NOW,
                selected: true,
                rowKey: `sl-${n}-a`,
                fileInfo: fileInfo({
                    sizeBytes: Math.round(dur * 135),
                    durationMs: dur,
                    bitrateKbps: 1011,
                    provenance: "lossless",
                }),
                progress: 100,
                providerDetail: "vinyl_archive",
                candidate: { name: `${t[0]} - ${t[1]}.flac`, sizeBytes: Math.round(dur * 135) },
                query: q(`${t[0]} ${t[1]} .flac`),
            },
            {
                state: "skipped",
                provider: "soulseek",
                track: sp,
                downloadedAt: NOW,
                selected: false,
                rowKey: `sl-${n}-b`,
                providerDetail: "nightcrawler",
                candidate: {
                    name: `${t[0]} - ${t[1]}.flac`,
                    sizeBytes: Math.round(dur * 128),
                    note: "queued",
                    audio: { bitrateKbps: 962, sampleRateHz: 44100, bitDepth: 16 },
                },
                query: q(`${t[0]} ${t[1]} .flac`),
            },
            {
                state: "skipped",
                provider: "soulseek",
                track: sp,
                downloadedAt: NOW,
                selected: false,
                rowKey: `sl-${n}-c`,
                providerDetail: "blue_monday",
                candidate: {
                    name: `01 ${t[1]}.flac`,
                    sizeBytes: Math.round(dur * 141),
                    audio: { bitrateKbps: 1054, sampleRateHz: 44100, bitDepth: 16 },
                },
                query: q(`${t[0]} ${t[1]} .flac`),
            }
        );
    }
    return rows;
}

function track(n, { parent, saved, downloaded } = {}) {
    const t = TRACKS[n];
    const has = t[6].split(" ");
    const groups = has.map((p) => group(t, p, n, p === "sp"));
    const sp = trackMeta(t, "sp", n);
    const mbId = `${sid(n * 31 + 5, 8).toLowerCase()}-e940-43c7-936f-9b30bbc4edf8`;
    const attributes = {
        kind: "track",
        state: "finished",
        uri: { platform: "spotify", type: "track", id: sp.id },
        recognizedServiceKey: "spotify",
        ...(parent ? { parentTaskId: parent } : {}),
        userInput: { type: "url", url: sp.url },
        metadataGroups: groups,
        metadataOverride: {},
        downloadSources: downloaded ? downloadRows(t, n, { saved }) : [],
        toTag: true,
        toDownload: !!downloaded,
        primaryMetadataInProgress: false,
        primaryMetadataFetched: true,
        metadataDiscoveringInProgress: false,
        metadataDiscovered: true,
        downloadsFetched: !!downloaded,
        discoveryAnchors: {
            songlink: {
                state: "found",
                url: `https://song.link/s/${sp.id}`,
                openUri: `https://song.link/s/${sp.id}`,
                count: has.length,
            },
            musicBrainz: {
                state: "found",
                url: `https://musicbrainz.org/recording/${mbId}`,
                id: mbId,
                openUri: `https://musicbrainz.org/recording/${mbId}`,
                count: 0,
            },
        },
        ...(saved
            ? {
                  savedFile: {
                      path: touch(`${t[0]} - ${t[1]}.flac`),
                      writtenPath: join(filesDir, `${t[0]} - ${t[1]}.flac`),
                      savedAt: NOW,
                      provider: "soulseek",
                      track: sp,
                      providerDetail: "vinyl_archive",
                      fileInfo: fileInfo({
                          sizeBytes: Math.round(t[4] * 135),
                          durationMs: t[4],
                          bitrateKbps: 1011,
                          provenance: "lossless",
                      }),
                  },
              }
            : {}),
    };
    return {
        id: `task:show${String(n).padStart(3, "0")}`,
        initialInput: sp.url,
        attributes,
        status: saved
            ? { type: "success", message: "Saved", timeTracking: false, startTime: null }
            : { type: "noStatus", message: "No status", timeTracking: false, startTime: null },
        prompt: null,
    };
}

// 0 is the focused, fully worked track; 2-4 are a playlist; the rest stand alone.
const PLAYLIST_ID = "task:showplaylist";
const tasks = [
    track(0, { saved: true, downloaded: true }),
    track(1, { saved: true, downloaded: true }),
    {
        id: PLAYLIST_ID,
        initialInput: "https://open.spotify.com/playlist/37i9dQZF1DXlate0night",
        attributes: {
            kind: "collection",
            collectionKind: "playlist",
            state: "finished",
            userInput: { type: "url", url: "https://open.spotify.com/playlist/37i9dQZF1DXlate0night" },
            recognizedServiceKey: "spotify",
            name: "Late night drive",
            ownerName: "alice",
            totalCount: 3,
            childTaskIds: ["task:show002", "task:show003", "task:show004"],
            collapsed: false,
            toTag: true,
            toDownload: false,
            live: { enabled: true, lastFetchedAt: NOW },
        },
        status: { type: "success", message: "3 tracks", timeTracking: false, startTime: null },
        prompt: null,
    },
    track(2, { parent: PLAYLIST_ID }),
    track(3, { parent: PLAYLIST_ID, downloaded: true }),
    track(4, { parent: PLAYLIST_ID, saved: true, downloaded: true }),
    ...[5, 6, 7, 8, 9, 10, 11].map((n) => track(n, { downloaded: n % 2 === 1, saved: n === 5 || n === 9 })),
];

const session = {
    id: "showcase-session",
    name: "Late night drive",
    flowId: "music-downloader",
    createdAt: NOW,
    updatedAt: NOW,
    tasks,
};
writeFileSync(
    join(root, "sessions.json"),
    JSON.stringify({ version: 1, lastSessionId: session.id, sessions: [session] }, null, 2)
);

writeFileSync(
    join(root, "settings.json"),
    JSON.stringify(
        {
            general: {
                reopenLastSession: true,
                animationsEnabled: true,
                theme: "dark",
                showWelcomeTutorial: false,
                checkForUpdates: false,
                cacheEnabled: false,
            },
            logs: { logLevel: "INFO", includeGlobalLogsInFocusedTask: false },
            keybindings: {},
            music: { onboarding: { providersChosen: true } },
            flows: {
                "music-downloader": {
                    metadata: {
                        autoChooseBestSource: false,
                        providers: { spotify: { enabled: true }, youtube: { enabled: true } },
                        discoveryProviders: {
                            songlink: { enabled: true, consentAsked: true },
                            musicBrainz: { enabled: true },
                            claude: { enabled: false, consentAsked: true },
                        },
                    },
                    download: {
                        autoChooseBestSource: true,
                        providers: { ytdlp: { enabled: true }, soulseek: { enabled: true } },
                    },
                    ui: { columnRatios: {} },
                },
            },
        },
        null,
        2
    )
);
// Spotify's mode without credentials: no field is required, so the setup wizard never opens over a screenshot
// (it would, the first time anything asks Spotify, e.g. the MusicBrainz check of the focused track).
writeFileSync(join(root, ".env"), "SPOTIFY_AUTH_MODE=scrape" + String.fromCharCode(10));
writeFileSync(1, "showcase fixture written to " + root + String.fromCharCode(10));
