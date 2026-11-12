import { type MusicBrainzIds } from "./compiledMetadata";

/**
 * The MusicBrainz ids a saved file carries: the label the UI shows, the Vorbis comment it is written to (and read
 * back as, whatever the format: see `tagAudioFile` / `readTags`), and where the id is in `MusicBrainzIds`.
 *
 * The labels follow MusicBrainz' own names for the entities, not the tag names: `MUSICBRAINZ_TRACKID` is the
 * *recording* (Picard's "Recording MBID") and `MUSICBRAINZ_RELEASETRACKID` is the *track* of the release.
 */
export const MUSICBRAINZ_TAG_FIELDS: readonly {
    label: string;
    /** For the narrow panels of the side-by-side view (9 columns). */
    shortLabel: string;
    tag: string;
    idOf: (ids: MusicBrainzIds) => string | undefined;
}[] = [
    { label: "Recording", shortLabel: "Recording", tag: "MUSICBRAINZ_TRACKID", idOf: (ids) => ids.recording },
    { label: "Release", shortLabel: "Release", tag: "MUSICBRAINZ_ALBUMID", idOf: (ids) => ids.release },
    { label: "Artist", shortLabel: "Artist", tag: "MUSICBRAINZ_ARTISTID", idOf: (ids) => ids.artist },
    {
        label: "Alb. artist",
        shortLabel: "Alb. art.",
        tag: "MUSICBRAINZ_ALBUMARTISTID",
        idOf: (ids) => ids.albumArtists?.join(", "),
    },
    { label: "Group", shortLabel: "Group", tag: "MUSICBRAINZ_RELEASEGROUPID", idOf: (ids) => ids.releaseGroup },
    { label: "Track", shortLabel: "Track", tag: "MUSICBRAINZ_RELEASETRACKID", idOf: (ids) => ids.releaseTrack },
];

/** Whether `tags` (as read from a file) holds at least one MusicBrainz id. */
export function hasMusicBrainzTags(tags: Record<string, string | string[]>): boolean {
    return MUSICBRAINZ_TAG_FIELDS.some(({ tag }) => !!(tags[tag] ?? tags[tag.toLowerCase()]));
}
