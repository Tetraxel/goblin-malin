/**
 * Data model of the MusicBrainz identity feature (P30): what the checks found, and the verdict drawn from it.
 *
 * Everything here is plain, serialisable data: `MusicBrainzIdentity` is stored on the task (and so in the session
 * file), the rest is what the pure resolver (`resolveIdentity.ts`) takes in.
 */

/** The four ways a release can be recognised — or ruled out — in MusicBrainz. */
export type MbCheckName = "barcode" | "url" | "isrc" | "search";

/**
 * Why a candidate release is on the table. "user" = the user picked it; "edition" = it is the digital edition of the
 * release the identifiers point to; "group" = it is another release of the same release group.
 */
export type MbEvidenceKind = MbCheckName | "user" | "edition" | "group";

/** What came of one lookup: it answered, it could not run (missing input), or it failed (network, rate limit…). */
export type CheckResult<T> =
    { status: "ok"; value: T } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

// ── MusicBrainz entities, trimmed to what the resolver needs ─────────────────────────────

export type MbArtistRef = {
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
};

export type MbRelease = {
    id: string;
    title: string;
    artists: MbArtistRef[];
    date?: string;
    country?: string;
    status?: string;
    barcode?: string;
    /** Tracks over all media. */
    trackCount?: number;
    format?: string;
    releaseGroupId?: string;
    /** Resources of the release's URL relationships, when they were fetched. */
    urls?: string[];
};

export type MbRecording = {
    id: string;
    title: string;
    lengthMs?: number;
    artists: MbArtistRef[];
    /** The releases this recording appears on (a recording lookup by ISRC includes them). */
    releases: MbRelease[];
};

export type MbSearchRelease = MbRelease & { score: number };

// ── What a streaming provider says about the album ───────────────────────────────────────

export type ProviderArtist = {
    name: string;
    /** The artist's page on the streaming provider (a stable key for matching to a MusicBrainz URL relationship). */
    url?: string;
};

export type ProviderAlbumTrack = {
    id: string;
    name: string;
    number?: number;
    discNumber?: number;
    durationMs?: number;
    isrc?: string;
    artists: ProviderArtist[];
};

export type ProviderAlbum = {
    id: string;
    name: string;
    url: string;
    albumType?: string;
    releaseDate?: string;
    /** UPC / EAN — the strongest key there is, when the provider gives it. */
    barcode?: string;
    trackCount?: number;
    artists: ProviderArtist[];
    /** The whole track list, when it was fetched (a seed needs it; the checks do not). */
    tracks: ProviderAlbumTrack[];
};

// ── Decisions the user took ──────────────────────────────────────────────────────────────

export type MbUserChoice = {
    /**
     * The album the release decision (`chosenRelease` / `rejectedReleaseIds`) was made for (`normalizeUrl` of its link).
     * If the track's album is another one later, the decision is kept but not applied. Absent = applies anywhere.
     */
    albumKey?: string;
    /** The release the user said this is (a snapshot, so it survives MusicBrainz data changing). */
    chosenRelease?: MbRelease;
    /** Releases the user said it is NOT. They never come back as candidates. */
    rejectedReleaseIds: string[];
    /** Per provider artist (key = `artistKey`): the MusicBrainz artist picked, or `null` = "a new artist". */
    artistChoices: Record<string, string | null>;
};

// ── The resolver's input ─────────────────────────────────────────────────────────────────

export type IdentityInput = {
    album: ProviderAlbum;
    track: {
        name: string;
        isrc?: string;
        artists: ProviderArtist[];
    };
    barcodeReleases: CheckResult<MbRelease[]>;
    urlReleases: CheckResult<MbRelease[]>;
    isrcRecordings: CheckResult<MbRecording[]>;
    searchReleases: CheckResult<MbSearchRelease[]>;
    /** Provider artist URL → the MusicBrainz artists that have that URL as a relationship. */
    artistsByUrl: Record<string, CheckResult<MbArtistRef[]>>;
    /** Normalised artist name → what a name search found. Only ever a source of candidates. */
    artistSearch: Record<string, CheckResult<MbArtistRef[]>>;
    /** The releases of the matched release's release group (fetched once a release is matched). Never a source of matches but the digital edition. */
    groupReleases?: CheckResult<MbRelease[]>;
    /** Releases handed back by the MusicBrainz editor after the user added one (already fetched by id). */
    knownReleases?: MbRelease[];
    user?: MbUserChoice;
    /** For tests. */
    now?: string;
};

// ── The resolver's output (stored on the task) ───────────────────────────────────────────

/** "matched" = a release is known; "needsReview" = candidates, the user decides; "notFound" = ruled out; "unknown" = could not tell. */
export type MbVerdict = "matched" | "needsReview" | "notFound" | "unknown";

export type MbReleaseCandidate = {
    release: MbRelease;
    evidence: MbEvidenceKind[];
    /** A recording of this release that has the track's ISRC. */
    recordingId?: string;
    /** Why it is a candidate, one short line each, worded for the user (filled in with the verdict). */
    notes?: string[];
};

export type MbResolvedArtist = {
    /** The provider's name for the artist. */
    name: string;
    url?: string;
    mbid?: string;
    /** Why `mbid` can be trusted. Absent when the artist is unresolved. */
    evidence?: "url" | "isrc" | "release" | "user";
    /** The user said it is none of the candidates: seed it by name only, MusicBrainz asks to create it. */
    isNew?: boolean;
    /** Same-name artists found by a name search — shown to the user, never linked on their own. */
    candidates: MbArtistRef[];
};

export type MbCheckSummary = {
    name: MbCheckName;
    status: "ok" | "skipped" | "failed";
    /** What it found (releases / recordings / hits). */
    hits: number;
    note?: string;
};

export type MusicBrainzIdentity = {
    verdict: MbVerdict;
    decidedBy: "auto" | "user";
    /** ISO date-time of the check. */
    checkedAt: string;
    release?: MbRelease;
    recordingId?: string;
    /**
     * With a matched release: the id of the track of that release that is `recordingId` (a recording appears as a
     * different "track" on every release it is on). Absent when the release's track list does not hold the recording.
     */
    releaseTrackId?: string;
    releaseGroupId?: string;
    artists: MbResolvedArtist[];
    candidates: MbReleaseCandidate[];
    /**
     * With a matched release: the other releases that could be the one (the evidence also pointed at them, or they
     * share its release group), so the user can see them and pick another. Empty otherwise.
     */
    alternatives?: MbReleaseCandidate[];
    checks: MbCheckSummary[];
    /** Human-readable evidence lines, in the order they matter. */
    evidence: string[];
    userChoice?: MbUserChoice;
    /** Fingerprint of the compiled metadata this verdict was made from (`musicBrainzInputKey`). */
    inputKey?: string;
    /** ISO date-time at which the user was handed over to MusicBrainz to add the release. */
    handedOffAt?: string;
};
