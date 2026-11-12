import { MusicBrainzApi, MusicBrainzApiError, type IRecording } from "musicbrainz-api";
import { APP_VERSION } from "#constants";
import { SEARCH_LIMIT } from "../../musicbrainz/thresholds";
import { toMbArtist, toMbRecording, toMbRelease } from "../../musicbrainz/mapMusicBrainz";
import { type MbArtistRef, type MbRecording, type MbRelease, type MbSearchRelease } from "../../musicbrainz/types";

/** Most releases / recordings fetched in full for one lookup (a URL or an ISRC shared by many entries is not worth the requests). */
const MAX_FETCHED = 3;

const MUSICBRAINZ_APP_NAME = "goblin-malin";
const MUSICBRAINZ_APP_CONTACT = "https://github.com/Tetraxel/goblin-malin";

/** A phrase in a Lucene query: quotes and backslashes inside it must not end it early. */
export function luceneQuote(value: string): string {
    return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** MusicBrainz answers 404 for "nothing with that ISRC / URL": that is an answer, not a failure. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
    try {
        return await request;
    } catch (error) {
        if (error instanceof MusicBrainzApiError && error.status === 404) return null;
        throw error;
    }
}

/**
 * Handles raw API communication with the MusicBrainz API.
 *
 * MusicBrainz exposes cross-platform streaming links as URL relationships on a recording, so
 * discovering "the same track on other platforms" is a two-step lookup: first resolve the source
 * track to a recording MBID (by ISRC when available, otherwise by title + artist), then fetch that
 * recording with its `url-rels` included.
 *
 * The identity lookups (barcode, URL, ISRC, artist, release) feed the pure resolver in `musicbrainz/`. They return
 * facts and decide nothing: a 404 is an empty list, every other failure throws, so the caller can tell "there is
 * none" from "could not ask".
 *
 * The underlying `MusicBrainzApi` client enforces MusicBrainz' rate limit internally, so instances
 * share a single process-wide client to keep that accounting global across concurrent tasks.
 */
export class MusicBrainzClient {
    private static api: MusicBrainzApi | null = null;

    /** Tests only: the API every client uses (`null` = the real one again). */
    static setApiForTesting(api: Pick<MusicBrainzApi, "lookup" | "lookupUrl" | "search" | "browse"> | null): void {
        MusicBrainzClient.api = api as MusicBrainzApi | null;
    }

    private getApi(): MusicBrainzApi {
        if (!MusicBrainzClient.api) {
            MusicBrainzClient.api = new MusicBrainzApi({
                appName: MUSICBRAINZ_APP_NAME,
                appVersion: APP_VERSION,
                appContactInfo: MUSICBRAINZ_APP_CONTACT,
            });
        }
        return MusicBrainzClient.api;
    }

    /**
     * Resolves the best-matching recording MBID for the given source fields.
     * Prefers the ISRC (an exact, cross-platform identifier) and falls back to a title + artist search.
     */
    async findRecordingId(params: { isrc?: string; trackName?: string; artistName?: string }): Promise<string | null> {
        const api = this.getApi();
        const { isrc, trackName, artistName } = params;

        if (isrc) {
            const byIsrc = await api.search("recording", { query: { isrc } });
            const top = byIsrc.recordings?.[0];
            if (top) return top.id;
        }

        if (trackName) {
            const query: Record<string, string> = { recording: trackName };
            if (artistName) query.artist = artistName;
            const byName = await api.search("recording", { query });
            const top = byName.recordings?.[0];
            if (top) return top.id;
        }

        return null;
    }

    /** Looks up a recording with its URL relationships (cross-platform links) and artist credits. */
    async getRecordingWithUrls(mbid: string): Promise<IRecording> {
        return this.getApi().lookup("recording", mbid, ["url-rels", "artists"]);
    }

    // ── Identity lookups (P30) ───────────────────────────────────────────────────────────

    /**
     * Releases with this barcode. A search, so the index can lag a few minutes behind an edit: a release that was
     * just added may not show up here yet (the URL lookup, straight from the database, does).
     */
    async findReleasesByBarcode(barcode: string): Promise<MbRelease[]> {
        const result = await this.getApi().search("release", {
            query: `barcode:${luceneQuote(barcode)}`,
            limit: SEARCH_LIMIT,
        });
        return (result.releases ?? []).map(toMbRelease);
    }

    /**
     * Releases that have `url` as a URL relationship (e.g. the streaming album link). A URL's relationships only carry
     * a stub of each release (no artists, no track count, no release group), so each is fetched in full — normally
     * exactly one.
     */
    async findReleasesByUrl(url: string): Promise<MbRelease[]> {
        const found = await orNull(this.getApi().lookupUrl(url, ["release-rels"]));
        if (!found) return [];
        const stubs = (found.relations ?? []).map((r) => r.release).filter((r): r is NonNullable<typeof r> => !!r?.id);
        const releases: MbRelease[] = [];
        for (const stub of stubs.slice(0, MAX_FETCHED)) {
            const full = await this.getRelease(stub.id);
            releases.push({ ...full, urls: [...new Set([url, ...(full.urls ?? [])])] });
        }
        // Past the cap the stub is kept: still evidence that the link is on a release, just without the details.
        for (const stub of stubs.slice(MAX_FETCHED)) releases.push({ ...toMbRelease(stub), urls: [url] });
        return releases;
    }

    /** Artists that have `url` as a URL relationship (e.g. the streaming artist page). */
    async findArtistsByUrl(url: string): Promise<MbArtistRef[]> {
        const found = await orNull(this.getApi().lookupUrl(url, ["artist-rels"]));
        if (!found) return [];
        return (found.relations ?? [])
            .map((r) => r.artist)
            .filter((a): a is NonNullable<typeof a> => !!a?.id)
            .map(toMbArtist);
    }

    /**
     * Recordings with this ISRC, each with the releases it appears on. The ISRC endpoint ignores `inc=releases`, so
     * each recording (normally one) is looked up by its id to get them. MusicBrainz lists at most 25 releases per
     * lookup: for a track on very many releases the list is not complete, which is fine — this is one of several
     * pieces of evidence, and the barcode and the streaming link do not depend on it.
     */
    async findRecordingsByIsrc(isrc: string): Promise<MbRecording[]> {
        const api = this.getApi();
        const found = await orNull(api.lookup("isrc", isrc, ["artist-credits"]));
        const recordings: MbRecording[] = [];
        for (const { id } of (found?.recordings ?? []).slice(0, MAX_FETCHED)) {
            recordings.push(
                toMbRecording(
                    await api.lookup("recording", id, ["releases", "media", "artist-credits", "release-groups"])
                )
            );
        }
        return recordings;
    }

    /** Releases matching an album title and artist name, with MusicBrainz' own relevance score. Only ever a hint. */
    async searchReleases(params: { title: string; artist?: string }): Promise<MbSearchRelease[]> {
        const parts = [`release:${luceneQuote(params.title)}`];
        if (params.artist) parts.push(`artist:${luceneQuote(params.artist)}`);
        const result = await this.getApi().search("release", { query: parts.join(" AND "), limit: SEARCH_LIMIT });
        return (result.releases ?? []).map((r) => ({ ...toMbRelease(r), score: r.score }));
    }

    /** Artists matching a name — candidates for a human to choose from, never a match on their own. */
    async searchArtists(name: string): Promise<MbArtistRef[]> {
        const result = await this.getApi().search("artist", {
            query: `artist:${luceneQuote(name)}`,
            limit: SEARCH_LIMIT,
        });
        return (result.artists ?? []).map(toMbArtist);
    }

    /**
     * Every release of a release group (the editions of one album: CD, digital, regional…), with its format and track
     * count. One request: a group has a handful of releases, 100 is the most MusicBrainz returns per page.
     */
    async findReleasesInGroup(releaseGroupId: string): Promise<MbRelease[]> {
        const result = await this.getApi().browse("release", { "release-group": releaseGroupId, limit: 100 }, [
            "media",
            "artist-credits",
            "release-groups",
        ]);
        return (result.releases ?? []).map(toMbRelease);
    }

    /**
     * The id of the track of `releaseId` that is the recording `recordingId` (what Picard writes as
     * `musicbrainz_releasetrackid`), or undefined when the release's track list does not hold it. The release is
     * fetched with its recordings, which is the only lookup that lists the tracks.
     */
    async findReleaseTrackId(releaseId: string, recordingId: string): Promise<string | undefined> {
        const release = await this.getApi().lookup("release", releaseId, ["recordings"]);
        for (const medium of release.media ?? []) {
            const track = (medium.tracks ?? []).find((t) => t.recording?.id === recordingId);
            if (track?.id) return track.id;
        }
        return undefined;
    }

    /** One release by MBID (straight from the database, not the search index), with its links and media. */
    async getRelease(mbid: string): Promise<MbRelease> {
        const release = await this.getApi().lookup("release", mbid, ["artists", "media", "release-groups", "url-rels"]);
        const mapped = toMbRelease(release);
        return { ...mapped, urls: mapped.urls ?? [] };
    }
}
