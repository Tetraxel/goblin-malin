import { Platform, TrackUri, TrackUriParts } from "../types";

// Serialize the structured URI to its canonical "PLATFORM::TRACK::ID" string form.
export function formatTrackUri(parts: TrackUriParts): TrackUri {
    return `${parts.platform.toUpperCase()}::TRACK::${parts.id}` as TrackUri;
}

// Best-effort parse of the canonical string form. Note that the string uppercases
// the platform, so casing is lost (e.g. "youtubeMusic" → "YOUTUBEMUSIC" → "youtubemusic").
// Prefer the stored object when exact platform casing matters; this is for
// display-only contexts where only the parts are needed.
export function parseTrackUri(uri: string): TrackUriParts | null {
    const parts = uri.split("::");
    if (parts.length !== 3 || parts[1] !== "TRACK") return null;
    return { platform: parts[0].toLowerCase() as Platform, type: "track", id: parts[2] };
}
