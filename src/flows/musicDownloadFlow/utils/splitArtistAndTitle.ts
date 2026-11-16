/** "Artist - Title": the way most uploads are named, with the artist only in the title and the uploader a label or fan. */
const ARTIST_TITLE = /^(.{1,80}?)\s+[-–—]\s+(.+)$/;

/**
 * How the text after the dash ends when it names a version of a song, not a song: "Song - Slowed", "Song - Flume
 * Remix", "Song - Sped Up". ("Oasis - Live Forever" does not end that way, and is split.)
 */
const VERSION_ENDING =
    /\b(remix|mix|edit|flip|bootleg|vip|rework|version|cover|slowed|reverb|sped up|speed up|nightcore|instrumental|acoustic|live|remaster(?:ed)?|extended|mashup|refix|dub)\s*$/i;

const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * "Artist - Title", or null when the title is not shaped like that. A dash also separates a song from its version
 * ("Never Be Like You - Flume Remix", "Song - Slowed"): then the text before it is the song, not an artist.
 * `uploader` is who published it (a SoundCloud user, a YouTube channel): an upload by the very name before the dash
 * ("Flume - Live" by Flume) is that artist's own.
 */
export function splitArtistAndTitle(title: string, uploader?: string): { artist: string; track: string } | null {
    const match = ARTIST_TITLE.exec(title.trim());
    if (!match) return null;
    const artist = match[1].trim();
    const track = match[2].trim();
    if (!artist || !track) return null;

    // What follows the dash, without its brackets: "Latch (Flume Remix)" is a title, "Flume Remix" is a version.
    const afterDash = track.replace(/[([{][^)\]}]*[)\]}]/g, " ").trim();
    if (!afterDash || VERSION_ENDING.test(afterDash)) {
        // "Song - Slowed", "Song - Flume Remix": a version of the song named before the dash, not an artist. The one
        // exception is an upload by the very name before the dash ("Flume - Live"): that is the artist.
        const uploaderName = uploader ? normalize(uploader) : "";
        if (!uploaderName || normalize(artist) !== uploaderName) return null;
    }
    return { artist, track };
}
