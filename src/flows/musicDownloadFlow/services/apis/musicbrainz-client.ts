import { MusicBrainzApi, IRecording } from "musicbrainz-api";
import { APP_VERSION } from "#constants";

const MUSICBRAINZ_APP_NAME = "goblin-malin";
const MUSICBRAINZ_APP_CONTACT = "https://github.com/Tetraxel/goblin-malin";

/**
 * Handles raw API communication with the MusicBrainz API.
 *
 * MusicBrainz exposes cross-platform streaming links as URL relationships on a recording, so
 * discovering "the same track on other platforms" is a two-step lookup: first resolve the source
 * track to a recording MBID (by ISRC when available, otherwise by title + artist), then fetch that
 * recording with its `url-rels` included.
 *
 * The underlying `MusicBrainzApi` client enforces MusicBrainz' rate limit internally, so instances
 * share a single process-wide client to keep that accounting global across concurrent tasks.
 */
export class MusicBrainzClient {
    private static api: MusicBrainzApi | null = null;

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
}
