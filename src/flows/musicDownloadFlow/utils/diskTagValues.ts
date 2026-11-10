import { readTags } from "./readFileInfo";
import { FIELDS } from "./metadataFields";
import { extensionOf } from "./outputFormat";

/** The tag each compiled field is written to (see `tagAudioFile`) and how to read it back as the field's text. */
const FIELD_TAGS: Record<string, (tags: Record<string, string | string[]>) => string | undefined> = {
    trackName: (t) => join(t.TITLE),
    artists: (t) => join(t.ARTIST),
    isrc: (t) => join(t.ISRC),
    album: (t) => join(t.ALBUM),
    year: (t) => join(t.DATE ?? t.YEAR)?.match(/^\d{4}/)?.[0],
    trackNumber: (t) => join(t.TRACKNUMBER)?.split("/")[0]?.trim(),
    bpm: (t) => join(t.BPM),
    key: (t) => join(t.KEY),
    genres: (t) => join(t.GENRE),
};

function join(value: string | string[] | undefined): string | undefined {
    const text = Array.isArray(value) ? value.join(", ") : value;
    return text?.trim() || undefined;
}

/**
 * What a file on disk really holds for every compiled field ("—" for a missing one), in the same text the
 * compiled metadata is shown in. It is the truth about a saved file, whatever was recorded when it was saved.
 */
export async function readDiskFieldValues(filePath: string): Promise<Record<string, string>> {
    const tags = await readTags(filePath, extensionOf(filePath));
    return Object.fromEntries(FIELDS.map((f) => [f.key, FIELD_TAGS[f.key]?.(tags) ?? "—"]));
}
