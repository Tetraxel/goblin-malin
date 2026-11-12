import { SEARCH_MIN_SCORE } from "./thresholds";
import { artistKey, normalizeBarcode, normalizeText, normalizeUrl, sameText } from "./normalize";
import {
    type CheckResult,
    type IdentityInput,
    type MbArtistRef,
    type MbCheckSummary,
    type MbEvidenceKind,
    type MbRecording,
    type MbRelease,
    type MbReleaseCandidate,
    type MbResolvedArtist,
    type MbUserChoice,
    type MusicBrainzIdentity,
    type ProviderAlbum,
    type ProviderArtist,
} from "./types";

/**
 * THE safety gate of the MusicBrainz feature: evidence in, verdict out. Nothing in here reads the network, the clock
 * or the settings, so every rule can be pinned down by a test — and has to be, because a wrong verdict writes a
 * wrong ID into someone's library (or, worse, proposes a duplicate release to MusicBrainz).
 *
 * A release is picked WITHOUT the user only when an identifier says so directly:
 *  1. Conclusive — the album's barcode is a release's barcode AND the track counts agree, or the album's streaming
 *     URL is already a URL relationship of a release. Exactly one such release → matched.
 *  2. Plausible — everything else still worth a human look (an ISRC on a release, a title + artist hit, a barcode
 *     with another track count…) → needsReview. The user picks; it is never applied automatically.
 *  3. Nothing — "notFound" only when all four checks ran and came back empty; if one could not run, "unknown".
 */
export function resolveMusicBrainzIdentity(input: IdentityInput): MusicBrainzIdentity {
    const { album, user } = input;
    const rejected = new Set(user?.rejectedReleaseIds ?? []);
    const checks = summarizeChecks(input);

    const pool = buildCandidatePool(input, rejected);
    const candidates = [...pool.values()];
    const recordings = input.isrcRecordings.status === "ok" ? input.isrcRecordings.value : [];

    let verdict: MusicBrainzIdentity["verdict"];
    let decidedBy: MusicBrainzIdentity["decidedBy"] = "auto";
    let chosen: MbReleaseCandidate | undefined;
    let review: MbReleaseCandidate[] = [];

    if (user?.chosenRelease) {
        // The user's word is final — for this track and the same album's other tracks.
        const existing = pool.get(user.chosenRelease.id);
        chosen = existing
            ? { ...existing, evidence: addUnique(existing.evidence, "user") }
            : { release: user.chosenRelease, evidence: ["user"] };
        verdict = "matched";
        decidedBy = "user";
    } else {
        const conclusive = candidates.filter((c) => isConclusive(c, album));
        if (conclusive.length === 1) {
            chosen = preferDigital(conclusive[0], input, rejected);
            verdict = "matched";
        } else if (conclusive.length > 1) {
            review = conclusive;
            verdict = "needsReview";
        } else {
            // Anything short of a direct identifier (barcode + track count, the streaming link) is the user's call.
            review = candidates.filter((c) => isPlausible(c, album));
            if (review.length > 0) {
                verdict = "needsReview";
            } else {
                // Ruled out only when EVERY check ran. A check that could not run proves nothing.
                verdict = checks.every((c) => c.status === "ok") ? "notFound" : "unknown";
                // The user turned down the candidates: that is their decision, not ours.
                if (verdict === "notFound" && rejected.size > 0) decidedBy = "user";
            }
        }
    }

    const release = chosen?.release;
    const artists = input.track.artists.map((artist) =>
        resolveArtist(artist, {
            artistsByUrl: input.artistsByUrl,
            artistSearch: input.artistSearch,
            recordings,
            release,
            user,
        })
    );

    return {
        verdict,
        decidedBy,
        checkedAt: input.now ?? new Date().toISOString(),
        release,
        recordingId: pickRecordingId(release?.id, recordings, chosen?.recordingId),
        releaseGroupId: release?.releaseGroupId,
        artists,
        candidates:
            verdict === "needsReview"
                ? sortCandidates(review).map((c) => ({ ...c, notes: describeCandidate(c, input) }))
                : [],
        alternatives: verdict === "matched" && chosen ? buildAlternatives(chosen, candidates, input, rejected) : [],
        checks,
        evidence: describeEvidence(verdict, chosen, review, checks, input),
        userChoice: user,
    };
}

// ── Candidates ───────────────────────────────────────────────────────────────────────────

type TrackCountAgreement = "agree" | "differ" | "unknown";

function trackCountAgreement(album: Pick<ProviderAlbum, "trackCount">, release: MbRelease): TrackCountAgreement {
    if (album.trackCount == null || release.trackCount == null) return "unknown";
    return album.trackCount === release.trackCount ? "agree" : "differ";
}

function addUnique<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list : [...list, item];
}

function mergeRelease(existing: MbRelease, incoming: MbRelease): MbRelease {
    const merged: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (value !== undefined && merged[key] === undefined) merged[key] = value;
    }
    return merged as MbRelease;
}

function buildCandidatePool(input: IdentityInput, rejected: Set<string>): Map<string, MbReleaseCandidate> {
    const pool = new Map<string, MbReleaseCandidate>();
    const albumBarcode = normalizeBarcode(input.album.barcode);
    const albumUrl = normalizeUrl(input.album.url);

    const add = (release: MbRelease, kind: MbEvidenceKind, recordingId?: string): void => {
        if (rejected.has(release.id)) return;
        const existing = pool.get(release.id);
        if (!existing) {
            pool.set(release.id, { release, evidence: [kind], ...(recordingId ? { recordingId } : {}) });
            return;
        }
        existing.release = mergeRelease(existing.release, release);
        existing.evidence = addUnique(existing.evidence, kind);
        if (recordingId && !existing.recordingId) existing.recordingId = recordingId;
    };

    // A search by barcode can return near misses: only an equal barcode counts as barcode evidence.
    if (input.barcodeReleases.status === "ok" && albumBarcode) {
        for (const release of input.barcodeReleases.value) {
            if (normalizeBarcode(release.barcode) === albumBarcode) add(release, "barcode");
        }
    }
    if (input.urlReleases.status === "ok") {
        for (const release of input.urlReleases.value) add(release, "url");
    }
    if (input.isrcRecordings.status === "ok") {
        for (const recording of input.isrcRecordings.value) {
            for (const release of recording.releases) add(release, "isrc", recording.id);
        }
    }
    if (input.searchReleases.status === "ok") {
        for (const release of input.searchReleases.value) {
            if (release.score >= SEARCH_MIN_SCORE) add(release, "search");
        }
    }
    // A release the editor sent back is held to the same standard: no evidence, no candidate.
    for (const release of input.knownReleases ?? []) {
        if (albumBarcode && normalizeBarcode(release.barcode) === albumBarcode) add(release, "barcode");
        if (albumUrl && release.urls?.some((u) => normalizeUrl(u) === albumUrl)) add(release, "url");
    }
    return pool;
}

const isDigital = (release: MbRelease): boolean => release.format?.toLowerCase() === "digital media";
const isOfficial = (release: MbRelease): boolean => !release.status || release.status === "Official";

/**
 * A streaming service sells the DIGITAL edition, but the identifiers (a barcode, a streaming link) often sit on
 * another edition of the same release — the CD, whose barcode the label reused. When the release the identifiers point
 * to is not digital, its release group is looked at: exactly one official Digital Media release there with the album's
 * track count is the one. Two (or none) leave the choice as it was: the alternatives are one button away.
 */
function preferDigital(matched: MbReleaseCandidate, input: IdentityInput, rejected: Set<string>): MbReleaseCandidate {
    if (isDigital(matched.release) || input.groupReleases?.status !== "ok") return matched;
    const digital = input.groupReleases.value.filter(
        (r) =>
            r.id !== matched.release.id &&
            isDigital(r) &&
            isOfficial(r) &&
            !rejected.has(r.id) &&
            trackCountAgreement(input.album, r) === "agree"
    );
    if (digital.length !== 1) return matched;
    const release = { ...digital[0], releaseGroupId: digital[0].releaseGroupId ?? matched.release.releaseGroupId };
    return { release, evidence: ["edition"] };
}

const MAX_ALTERNATIVES = 12;

/** The other releases that could be this track's: those the evidence pointed at, then the rest of the release group. */
function buildAlternatives(
    chosen: MbReleaseCandidate,
    candidates: MbReleaseCandidate[],
    input: IdentityInput,
    rejected: Set<string>
): MbReleaseCandidate[] {
    const seen = new Set([chosen.release.id]);
    const list: MbReleaseCandidate[] = [];
    for (const c of sortCandidates(candidates)) {
        if (seen.has(c.release.id)) continue;
        seen.add(c.release.id);
        list.push(c);
    }
    const siblings = (input.groupReleases?.status === "ok" ? input.groupReleases.value : [])
        .filter((r) => !seen.has(r.id) && !rejected.has(r.id) && isOfficial(r))
        // Digital first (what a streaming service sells), then oldest first.
        .sort((a, b) => Number(isDigital(b)) - Number(isDigital(a)) || (a.date ?? "").localeCompare(b.date ?? ""));
    for (const release of siblings) list.push({ release, evidence: ["group"] });
    return list.slice(0, MAX_ALTERNATIVES).map((c) => ({ ...c, notes: describeCandidate(c, input) }));
}

function isConclusive(candidate: MbReleaseCandidate, album: ProviderAlbum): boolean {
    if (candidate.evidence.includes("url")) return true;
    return candidate.evidence.includes("barcode") && trackCountAgreement(album, candidate.release) === "agree";
}

function isPlausible(candidate: MbReleaseCandidate, album: ProviderAlbum): boolean {
    const { evidence, release } = candidate;
    // Same barcode but the track count differs or is unknown: very likely the album, but not sure enough alone.
    if (evidence.includes("barcode")) return true;
    // The track is on it (a compilation, a single and an album all can be) — only worth showing if it looks like the album.
    if (evidence.includes("isrc")) {
        return sameText(release.title, album.name) || trackCountAgreement(album, release) === "agree";
    }
    return (
        evidence.includes("search") &&
        sameText(release.title, album.name) &&
        trackCountAgreement(album, release) === "agree"
    );
}

function sortCandidates(candidates: MbReleaseCandidate[]): MbReleaseCandidate[] {
    const strength = (c: MbReleaseCandidate) =>
        (c.evidence.includes("url") ? 8 : 0) +
        (c.evidence.includes("barcode") ? 4 : 0) +
        (c.evidence.includes("isrc") ? 2 : 0) +
        (c.evidence.includes("search") ? 1 : 0);
    return [...candidates].sort((a, b) => strength(b) - strength(a) || a.release.id.localeCompare(b.release.id));
}

/**
 * The recording of this track on `releaseId`: the one recording with the track's ISRC that is on that release.
 * Without a release, an ISRC that names exactly one recording is enough. Two candidates are no answer.
 */
function pickRecordingId(
    releaseId: string | undefined,
    recordings: MbRecording[],
    fromCandidate: string | undefined
): string | undefined {
    if (releaseId) {
        const onRelease = recordings.filter((r) => r.releases.some((x) => x.id === releaseId));
        if (onRelease.length === 1) return onRelease[0].id;
        if (onRelease.length > 1)
            return fromCandidate && onRelease.some((r) => r.id === fromCandidate) ? fromCandidate : undefined;
        return undefined;
    }
    return recordings.length === 1 ? recordings[0].id : undefined;
}

// ── Artists ──────────────────────────────────────────────────────────────────────────────

export type ArtistContext = {
    artistsByUrl: Record<string, CheckResult<MbArtistRef[]>>;
    artistSearch: Record<string, CheckResult<MbArtistRef[]>>;
    recordings: MbRecording[];
    release?: MbRelease;
    user?: MbUserChoice;
};

/**
 * Whether `artist` may be linked to a MusicBrainz artist — and to which. A name alone is never enough: two artists
 * can share one. The only accepted evidence is (in this order) the user's pick, the credit of the release we are
 * sure about, the artist's streaming page being linked in MusicBrainz, and the credit of a recording that carries
 * the track's ISRC. Same-name search hits are kept as `candidates` for a human to choose from, nothing more.
 */
export function resolveArtist(artist: ProviderArtist, ctx: ArtistContext): MbResolvedArtist {
    const key = artistKey(artist);
    const candidates: MbArtistRef[] = [];
    const base: MbResolvedArtist = { name: artist.name, url: artist.url, candidates };

    const pick = ctx.user?.artistChoices[key];
    if (pick !== undefined) {
        return pick === null ? { ...base, isNew: true } : { ...base, mbid: pick, evidence: "user" };
    }

    const credited = ctx.release?.artists.find((a) => sameText(a.name, artist.name));
    if (credited) return { ...base, mbid: credited.id, evidence: "release" };

    if (artist.url) {
        const byUrl = ctx.artistsByUrl[normalizeUrl(artist.url)];
        if (byUrl?.status === "ok") {
            if (byUrl.value.length === 1) return { ...base, mbid: byUrl.value[0].id, evidence: "url" };
            candidates.push(...byUrl.value);
        }
    }

    const fromRecordings = new Map<string, MbArtistRef>();
    for (const recording of ctx.recordings) {
        for (const credit of recording.artists) {
            if (sameText(credit.name, artist.name)) fromRecordings.set(credit.id, credit);
        }
    }
    if (fromRecordings.size === 1) {
        return { ...base, mbid: [...fromRecordings.keys()][0], evidence: "isrc" };
    }
    for (const credit of fromRecordings.values()) addCandidate(candidates, credit);

    const search = ctx.artistSearch[normalizeText(artist.name)];
    if (search?.status === "ok") {
        for (const found of search.value) addCandidate(candidates, found);
    }
    return base;
}

function addCandidate(list: MbArtistRef[], artist: MbArtistRef): void {
    if (!list.some((a) => a.id === artist.id)) list.push(artist);
}

// ── Summaries ────────────────────────────────────────────────────────────────────────────

function summarize<T>(
    name: MbCheckSummary["name"],
    result: CheckResult<T>,
    count: (value: T) => number
): MbCheckSummary {
    if (result.status === "ok") return { name, status: "ok", hits: count(result.value) };
    if (result.status === "skipped") return { name, status: "skipped", hits: 0, note: result.reason };
    return { name, status: "failed", hits: 0, note: result.error };
}

function summarizeChecks(input: IdentityInput): MbCheckSummary[] {
    return [
        summarize("barcode", input.barcodeReleases, (v) => v.length),
        summarize("url", input.urlReleases, (v) => v.length),
        summarize("isrc", input.isrcRecordings, (v) => v.length),
        summarize("search", input.searchReleases, (v) => v.filter((r) => r.score >= SEARCH_MIN_SCORE).length),
    ];
}

const CHECK_LABELS: Record<MbCheckSummary["name"], string> = {
    barcode: "barcode",
    url: "streaming link",
    isrc: "ISRC",
    search: "title + artist",
};

export function checkLabel(name: MbCheckSummary["name"]): string {
    return CHECK_LABELS[name];
}

function describeEvidence(
    verdict: MusicBrainzIdentity["verdict"],
    chosen: MbReleaseCandidate | undefined,
    review: MbReleaseCandidate[],
    checks: MbCheckSummary[],
    input: IdentityInput
): string[] {
    const lines: string[] = [];
    if (verdict === "matched" && chosen) {
        lines.push(...describeCandidate(chosen, input));
    } else if (verdict === "needsReview") {
        lines.push(`${review.length} possible release${review.length === 1 ? "" : "s"} — please check`);
    } else if (verdict === "notFound") {
        lines.push(
            `Checked: ${checks.map((c) => `${CHECK_LABELS[c.name]} ✔ none`).join(" · ")}${
                (input.user?.rejectedReleaseIds.length ?? 0) > 0 ? " · candidates you turned down" : ""
            }`
        );
    } else {
        for (const c of checks.filter((check) => check.status !== "ok")) {
            lines.push(
                `${CHECK_LABELS[c.name]}: ${c.status === "skipped" ? "not checked" : "failed"} (${c.note ?? "?"})`
            );
        }
    }
    return lines;
}

/** One short line per reason a release is on the table. */
export function describeCandidate(
    candidate: MbReleaseCandidate,
    input: { album: Pick<ProviderAlbum, "barcode" | "trackCount">; track: { isrc?: string } }
): string[] {
    const lines: string[] = [];
    const { album, track } = input;
    for (const kind of candidate.evidence) {
        if (kind === "user") lines.push("You chose this release");
        else if (kind === "barcode")
            lines.push(`Barcode ${album.barcode} matches${trackCountNote(album, candidate.release)}`);
        else if (kind === "edition")
            lines.push("The digital edition of the release the barcode / streaming link points to");
        else if (kind === "group") lines.push("Another release of the same release group");
        else if (kind === "url") lines.push("The streaming album link is already on this release");
        else if (kind === "isrc") lines.push(`ISRC ${track.isrc} is on this release`);
        else lines.push("Title and artist match");
    }
    return lines;
}

function trackCountNote(album: Pick<ProviderAlbum, "trackCount">, release: MbRelease): string {
    const agreement = trackCountAgreement(album, release);
    if (agreement === "agree") return ` · ${release.trackCount} tracks`;
    if (agreement === "differ") return ` · but ${release.trackCount} tracks here vs ${album.trackCount}`;
    return "";
}
