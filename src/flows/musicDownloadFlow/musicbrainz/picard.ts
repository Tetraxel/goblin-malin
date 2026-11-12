/**
 * MusicBrainz Picard's browser integration: while Picard runs it listens on a local port (8000 by default), and a
 * request to one of these addresses makes it load the release (to match files to it) or the recording (as a track
 * without an album). https://picard-docs.musicbrainz.org/en/config/options_network.html
 *
 * It is a plain HTTP server on 127.0.0.1, so the app makes the request itself (`sendToPicard`): no browser window or
 * tab is involved. (Handing the address to the browser, as a link, only works as a side effect and leaves an empty
 * tab — or an error page when Picard is not running.)
 */
export const DEFAULT_PICARD_PORT = 8000;

/** The port from the settings text; anything that is not a valid port means the default. */
export function picardPort(setting: unknown): number {
    const text = String(setting ?? "").trim();
    const port = /^\d+$/.test(text) ? Number(text) : NaN;
    return port >= 1 && port <= 65535 ? port : DEFAULT_PICARD_PORT;
}

const base = (port: number): string => `http://127.0.0.1:${port}`;

export const picardOpenReleaseUrl = (releaseMbid: string, port = DEFAULT_PICARD_PORT): string =>
    `${base(port)}/openalbum?id=${releaseMbid}`;
export const picardOpenRecordingUrl = (recordingMbid: string, port = DEFAULT_PICARD_PORT): string =>
    `${base(port)}/opennat?id=${recordingMbid}`;

/** What Picard is asked to load, in the order of preference. */
export type PicardTarget = {
    url: string;
    /**
     * "release": the release the track is matched to. "candidate": the verdict is still "needs review" and this is its
     * strongest candidate (not confirmed). "recording": no release is known at all.
     */
    kind: "release" | "candidate" | "recording";
};

/**
 * The release is ALWAYS preferred to the standalone recording: files organised under a release get their album,
 * track number and cover art, a bare recording gives none of it. In order:
 *  1. the release the track is matched to (confirmed by the evidence, or chosen by the user);
 *  2. while the match still needs a review, its strongest candidate release — Picard only LOADS it, the user sees
 *     what it is before saving anything, so a best guess is harmless there;
 *  3. only when no release is known at all: the recording.
 */
export function picardTargetFor(
    known: {
        release?: { id: string };
        candidates?: { release: { id: string } }[];
        recordingId?: string;
    },
    port = DEFAULT_PICARD_PORT
): PicardTarget | undefined {
    if (known.release) return { url: picardOpenReleaseUrl(known.release.id, port), kind: "release" };
    const candidate = known.candidates?.[0];
    if (candidate) return { url: picardOpenReleaseUrl(candidate.release.id, port), kind: "candidate" };
    if (known.recordingId) return { url: picardOpenRecordingUrl(known.recordingId, port), kind: "recording" };
    return undefined;
}

/** The Picard address for what is known about a track (see `picardTargetFor`). */
export function picardUrlFor(
    known: Parameters<typeof picardTargetFor>[0],
    port = DEFAULT_PICARD_PORT
): string | undefined {
    return picardTargetFor(known, port)?.url;
}

/**
 * Asks the running Picard to load `url` (one of the addresses above) — directly, without a browser. True when Picard
 * answered; false when nothing listens there (Picard is not running, its browser integration is off, or it is on
 * another port) or it did not answer in time. Any HTTP answer counts: Picard replies with a redirect or an empty page.
 */
export async function sendToPicard(url: string, timeoutMs = 3000): Promise<boolean> {
    try {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
        await response.body?.cancel();
        return true;
    } catch {
        return false;
    }
}
