import { canonicalUrl, normalizeText, sameText } from "./normalize";
import { type MbResolvedArtist, type ProviderAlbum, type ProviderAlbumTrack, type ProviderArtist } from "./types";

/**
 * The form fields that pre-fill MusicBrainz' "Add release" editor — a POST to /release/add.
 * Spec: https://wiki.musicbrainz.org/Development/Seeding/Release_Editor (field names are quoted from it).
 *
 * Pure: the caller has already checked that the release does not exist and resolved the artists; this only lays out
 * what is known. Rules that keep the seed honest:
 *  - an artist MBID is sent only when it was linked on evidence (see `resolveArtist`); otherwise the artist goes by
 *    name only, which makes the editor search for it — and ask the user to create it — right where homonyms and
 *    disambiguation comments are visible;
 *  - a recording MBID is sent only for a track whose ISRC names exactly one recording;
 *  - nothing is invented: no barcode, no label, no language, no release group unless known.
 */
export type SeedField = readonly [name: string, value: string];

export type ReleaseSeedInput = {
    album: ProviderAlbum;
    /** The album's artists, resolved (same order as `album.artists`). */
    albumArtists: MbResolvedArtist[];
    /** Resolved artists by `artistKey`-independent lookup: the provider's artist name (normalised) → resolution. */
    artistByName?: Record<string, MbResolvedArtist>;
    /** Provider track id → the one MusicBrainz recording its ISRC names. */
    recordingByTrackId?: Record<string, string>;
    editNote: string;
    /** Where MusicBrainz sends the user after "Enter edit"; it appends `release_mbid`. */
    redirectUri?: string;
};

export type ReleaseSeed = {
    fields: SeedField[];
    /** What the user is shown before anything leaves the machine. */
    preview: SeedPreview;
};

export type SeedPreview = {
    name: string;
    type: string;
    date?: string;
    barcode?: string;
    artists: { name: string; how: string }[];
    trackCount: number;
    reusedRecordings: number;
    link: string;
    editNote: string;
};

export const MUSICBRAINZ_ADD_RELEASE_URL = "https://musicbrainz.org/release/add";

/** "worldwide": the country MusicBrainz uses for a release that is not tied to a market (digital streaming). */
const WORLDWIDE = "XW";

/** Release group type names (primary, then secondary) for a provider's album type. */
function releaseTypes(albumType: string | undefined): string[] {
    switch (albumType?.toLowerCase()) {
        case "album":
            return ["Album"];
        case "single":
            return ["Single"];
        case "ep":
            return ["EP"];
        case "compilation":
            return ["Album", "Compilation"];
        default:
            return [];
    }
}

function joinPhraseAt(index: number, total: number): string {
    if (index >= total - 1) return "";
    return index === total - 2 ? " & " : ", ";
}

function artistCredit(
    prefix: string,
    artists: ProviderArtist[],
    resolved: (a: ProviderArtist) => MbResolvedArtist | undefined
): SeedField[] {
    const fields: SeedField[] = [];
    artists.forEach((artist, i) => {
        const r = resolved(artist);
        const p = `${prefix}.names.${i}`;
        if (r?.mbid) fields.push([`${p}.mbid`, r.mbid]);
        fields.push([`${p}.name`, artist.name]);
        // The prefill the editor searches with — only useful (and only sent) when the artist is not linked.
        if (!r?.mbid) fields.push([`${p}.artist.name`, artist.name]);
        const join = joinPhraseAt(i, artists.length);
        if (join) fields.push([`${p}.join_phrase`, join]);
    });
    return fields;
}

function dateFields(releaseDate: string | undefined): SeedField[] {
    const match = releaseDate?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!match) return [];
    const fields: SeedField[] = [["events.0.date.year", String(Number(match[1]))]];
    if (match[2]) fields.push(["events.0.date.month", String(Number(match[2]))]);
    if (match[3]) fields.push(["events.0.date.day", String(Number(match[3]))]);
    fields.push(["events.0.country", WORLDWIDE]);
    return fields;
}

export function buildReleaseSeed(input: ReleaseSeedInput): ReleaseSeed {
    const { album } = input;
    const resolveByName = (a: ProviderArtist): MbResolvedArtist | undefined =>
        input.albumArtists.find((r) => sameText(r.name, a.name)) ?? input.artistByName?.[normalizeText(a.name)];

    const fields: SeedField[] = [
        ["name", album.name],
        ["status", "official"],
    ];
    for (const type of releaseTypes(album.albumType)) fields.push(["type", type]);
    if (album.barcode) fields.push(["barcode", album.barcode]);
    fields.push(...dateFields(album.releaseDate));
    fields.push(...artistCredit("artist_credit", album.artists, resolveByName));

    // Mediums: one per disc, tracks in order. A track list we do not have yields no tracks (the editor still opens).
    const discs = new Map<number, ProviderAlbumTrack[]>();
    for (const track of album.tracks) {
        const disc = track.discNumber ?? 1;
        discs.set(disc, [...(discs.get(disc) ?? []), track]);
    }
    let reused = 0;
    [...discs.entries()]
        .sort(([a], [b]) => a - b)
        .forEach(([, tracks], m) => {
            fields.push([`mediums.${m}.format`, "Digital Media"]);
            [...tracks]
                .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
                .forEach((track, i) => {
                    const p = `mediums.${m}.track.${i}`;
                    fields.push([`${p}.name`, track.name]);
                    if (track.number != null) fields.push([`${p}.number`, String(track.number)]);
                    if (track.durationMs != null) fields.push([`${p}.length`, String(Math.round(track.durationMs))]);
                    const recording = input.recordingByTrackId?.[track.id];
                    if (recording) {
                        fields.push([`${p}.recording`, recording]);
                        reused++;
                    }
                    // A track credited differently from the album (a feature, a compilation) carries its own credit.
                    if (!sameArtists(track.artists, album.artists)) {
                        fields.push(...artistCredit(`${p}.artist_credit`, track.artists, resolveByName));
                    }
                });
        });

    const link = canonicalUrl(album.url);
    if (album.url) fields.push(["urls.0.url", link]);
    fields.push(["edit_note", input.editNote]);
    if (input.redirectUri) fields.push(["redirect_uri", input.redirectUri]);

    return {
        fields,
        preview: {
            name: album.name,
            type: releaseTypes(album.albumType).join(" + ") || "—",
            date: album.releaseDate,
            barcode: album.barcode,
            artists: album.artists.map((a) => {
                const r = resolveByName(a);
                return { name: a.name, how: describeArtistLink(r) };
            }),
            trackCount: album.tracks.length,
            reusedRecordings: reused,
            link,
            editNote: input.editNote,
        },
    };
}

function sameArtists(a: ProviderArtist[], b: ProviderArtist[]): boolean {
    if (a.length !== b.length) return false;
    const names = new Set(b.map((x) => normalizeText(x.name)));
    return a.every((x) => names.has(normalizeText(x.name)));
}

const EVIDENCE_TEXT: Record<NonNullable<MbResolvedArtist["evidence"]>, string> = {
    url: "matched by their streaming page",
    isrc: "matched by a recording's ISRC",
    release: "matched by the release",
    user: "picked by you",
};

export function describeArtistLink(artist: MbResolvedArtist | undefined): string {
    if (artist?.mbid && artist.evidence) return `existing artist (${EVIDENCE_TEXT[artist.evidence]})`;
    if (artist?.isNew) return "new artist (you said none of the candidates): MusicBrainz asks you to create it";
    return "not linked: you search for it in MusicBrainz' editor";
}

/** The dialog text shown before anything is sent. */
export function formatSeedPreview(preview: SeedPreview, via: string): string {
    const lines = [
        `${preview.name}${preview.type !== "—" ? `  (${preview.type})` : ""}`,
        ...preview.artists.map((a) => `Artist: ${a.name} — ${a.how}`),
        `Date: ${preview.date ?? "—"}${preview.barcode ? ` · Barcode: ${preview.barcode}` : ""}`,
        preview.trackCount > 0
            ? `Tracks: ${preview.trackCount}${preview.reusedRecordings > 0 ? `, ${preview.reusedRecordings} reuse an existing recording` : ""}`
            : "Tracks: left for you to fill in",
        `Link: ${preview.link}`,
        "",
        via,
        "Nothing is submitted by Goblin Malin: MusicBrainz shows its own confirmation, then its editor, where you review and press “Enter edit”.",
    ];
    return lines.join("\n");
}
