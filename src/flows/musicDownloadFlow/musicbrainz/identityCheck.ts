import { canonicalUrl, normalizeBarcode, normalizeText, normalizeUrl } from "./normalize";
import { resolveMusicBrainzIdentity } from "./resolveIdentity";
import {
    type CheckResult,
    type IdentityInput,
    type MbArtistRef,
    type MbRecording,
    type MbRelease,
    type MbSearchRelease,
    type MbUserChoice,
    type MusicBrainzIdentity,
    type ProviderAlbum,
    type ProviderArtist,
} from "./types";

/** The reads the checks need. `MusicBrainzClient` implements them; tests pass a fake. */
export interface MusicBrainzLookups {
    findReleasesByBarcode(barcode: string): Promise<MbRelease[]>;
    findReleasesByUrl(url: string): Promise<MbRelease[]>;
    findArtistsByUrl(url: string): Promise<MbArtistRef[]>;
    findRecordingsByIsrc(isrc: string): Promise<MbRecording[]>;
    searchReleases(params: { title: string; artist?: string }): Promise<MbSearchRelease[]>;
    searchArtists(name: string): Promise<MbArtistRef[]>;
    getRelease(mbid: string): Promise<MbRelease>;
    /** The releases (editions) of a release group. */
    findReleasesInGroup(releaseGroupId: string): Promise<MbRelease[]>;
    /** The id of the track of a release that is a given recording (see `MusicBrainzIdentity.releaseTrackId`). */
    findReleaseTrackId?(releaseId: string, recordingId: string): Promise<string | undefined>;
}

// ── A small shared memory of answers ─────────────────────────────────────────────────────
//
// Every track of an album asks the same album-level questions (barcode, streaming link, title search), and every
// track of an artist the same artist-level ones. They are answered once and shared, in flight too. Only good
// answers are kept: a failure is retried by the next caller. A re-check forces fresh answers — except those
// fetched a moment ago (a batch re-check of a whole album must not ask the same thing ten times).

const FRESH_MS = 5_000;
type Entry = { at: number; promise: Promise<CheckResult<unknown>> };
const memory = new Map<string, Entry>();

export function clearMusicBrainzMemory(): void {
    memory.clear();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function memo<T>(key: string, force: boolean, run: () => Promise<T>): Promise<CheckResult<T>> {
    const hit = memory.get(key);
    if (hit && (!force || Date.now() - hit.at < FRESH_MS)) return hit.promise as Promise<CheckResult<T>>;
    const promise: Promise<CheckResult<T>> = run().then(
        (value) => ({ status: "ok" as const, value }),
        (error) => ({ status: "failed" as const, error: errorMessage(error) })
    );
    const entry: Entry = { at: Date.now(), promise };
    memory.set(key, entry);
    void promise.then((result) => {
        if (result.status !== "ok" && memory.get(key) === entry) memory.delete(key);
    });
    return promise;
}

const skipped = <T>(reason: string): CheckResult<T> => ({ status: "skipped", reason });

// ── The checks ───────────────────────────────────────────────────────────────────────────

export type IdentityCheckOptions = {
    /** Ask again instead of reusing answers (a re-check). */
    force?: boolean;
    /** A release the MusicBrainz editor reported (already added by the user): fetched by id and held to the same evidence rules. */
    knownReleaseId?: string;
    /** The user's decisions so far; they are kept and applied. */
    user?: MbUserChoice;
};

export type IdentityTrack = {
    name: string;
    isrc?: string;
    artists: ProviderArtist[];
};

/**
 * Runs the four checks for one track (barcode, streaming link, ISRC, title + artist), resolves the verdict, and — for
 * artists the evidence could not link — looks up same-name candidates for the user. Never throws: a lookup that
 * fails is recorded as `failed`, which keeps the verdict from ever being "not found".
 */
export async function checkMusicBrainzIdentity(
    lookups: MusicBrainzLookups,
    album: ProviderAlbum,
    track: IdentityTrack,
    options: IdentityCheckOptions = {}
): Promise<MusicBrainzIdentity> {
    const force = options.force ?? false;
    const albumUrl = album.url ? canonicalUrl(album.url) : "";
    const leadArtist = album.artists[0]?.name ?? track.artists[0]?.name;

    const barcodeReleases: Promise<CheckResult<MbRelease[]>> = album.barcode
        ? memo(`barcode:${normalizeBarcode(album.barcode)}`, force, () => lookups.findReleasesByBarcode(album.barcode!))
        : Promise.resolve(skipped("the streaming service gave no barcode for this album"));

    const urlReleases: Promise<CheckResult<MbRelease[]>> = albumUrl
        ? memo(`url:${normalizeUrl(albumUrl)}`, force, () => lookups.findReleasesByUrl(albumUrl))
        : Promise.resolve(skipped("no album link"));

    const isrcRecordings: Promise<CheckResult<MbRecording[]>> = track.isrc
        ? memo(`isrc:${track.isrc.toUpperCase()}`, force, () => lookups.findRecordingsByIsrc(track.isrc!))
        : Promise.resolve(skipped("this track has no ISRC"));

    const searchReleases: Promise<CheckResult<MbSearchRelease[]>> = album.name
        ? memo(`search:${normalizeText(album.name)}|${normalizeText(leadArtist)}`, force, () =>
              lookups.searchReleases({ title: album.name, artist: leadArtist })
          )
        : Promise.resolve(skipped("the album has no title"));

    const artistsByUrl: Record<string, Promise<CheckResult<MbArtistRef[]>>> = {};
    for (const artist of track.artists) {
        if (!artist.url) continue;
        const key = normalizeUrl(artist.url);
        artistsByUrl[key] = memo(`artistUrl:${key}`, force, () => lookups.findArtistsByUrl(canonicalUrl(artist.url!)));
    }

    const knownReleaseId = options.knownReleaseId;
    const known: Promise<CheckResult<MbRelease>> | undefined = knownReleaseId
        ? memo(`release:${knownReleaseId}`, true, () => lookups.getRelease(knownReleaseId))
        : undefined;

    const [barcode, url, isrc, search, knownResult] = await Promise.all([
        barcodeReleases,
        urlReleases,
        isrcRecordings,
        searchReleases,
        known,
    ]);
    const byUrl: IdentityInput["artistsByUrl"] = {};
    for (const [key, pending] of Object.entries(artistsByUrl)) byUrl[key] = await pending;

    const input: IdentityInput = {
        album,
        track,
        barcodeReleases: barcode,
        urlReleases: url,
        isrcRecordings: isrc,
        searchReleases: search,
        artistsByUrl: byUrl,
        artistSearch: {},
        knownReleases: knownResult?.status === "ok" ? [knownResult.value] : undefined,
        user: options.user,
    };

    let identity = resolveMusicBrainzIdentity(input);

    // A release is matched: its release group says which edition it should be (the digital one, for a streaming
    // service) and what the alternatives are. A failed lookup only leaves those out: the match itself stands.
    const groupId = identity.verdict === "matched" ? identity.release?.releaseGroupId : undefined;
    if (groupId) {
        input.groupReleases = await memo(`group:${groupId}`, force, () => lookups.findReleasesInGroup(groupId));
        identity = resolveMusicBrainzIdentity(input);
    }

    // Artists the evidence could not link get same-name candidates — to show, never to link.
    const unresolved = identity.artists.filter((a) => !a.mbid && !a.isNew);
    if (unresolved.length > 0) {
        for (const artist of unresolved) {
            const key = normalizeText(artist.name);
            if (!key || input.artistSearch[key]) continue;
            input.artistSearch[key] = await memo(`artistSearch:${key}`, force, () =>
                lookups.searchArtists(artist.name)
            );
        }
        identity = resolveMusicBrainzIdentity(input);
    }

    // The matched release and the recording are known: which track of the release is it? Only the track list says.
    // A failed lookup just leaves the id out, like the release group above.
    const releaseId = identity.verdict === "matched" ? identity.release?.id : undefined;
    const recordingId = identity.recordingId;
    if (releaseId && recordingId && lookups.findReleaseTrackId) {
        const find = lookups.findReleaseTrackId.bind(lookups);
        const found = await memo(`releaseTrack:${releaseId}:${recordingId}`, force, () => find(releaseId, recordingId));
        if (found.status === "ok" && found.value) identity = { ...identity, releaseTrackId: found.value };
    }
    return identity;
}

/** The identity of a track whose album could not be determined at all. */
export function unknownIdentity(reason: string, previous?: MusicBrainzIdentity): MusicBrainzIdentity {
    return {
        verdict: "unknown",
        decidedBy: "auto",
        checkedAt: new Date().toISOString(),
        artists: [],
        candidates: [],
        checks: [],
        evidence: [reason],
        ...(previous?.userChoice ? { userChoice: previous.userChoice } : {}),
    };
}
