import { httpsGetJson } from "./http";

/**
 * Where the Windows ffmpeg/ffprobe binaries come from. `BtbN/FFmpeg-Builds` moved to the
 * `FFmpeg-Builds` organisation: GitHub still answers `301` for the old name (which the http
 * helper follows), but pointing at the real location saves a hop and survives that redirect
 * being dropped one day. Both ffmpeg-setup.ts and ffprobe-setup.ts read it from here, so a
 * future move is a one-line change.
 */
export const FFMPEG_BUILDS_REPO = "FFmpeg-Builds/FFmpeg-Builds";
const WIN64_ARCHIVE = "ffmpeg-master-latest-win64-gpl.zip";

interface GitHubRelease {
    tag_name?: string;
    published_at?: string;
}

export interface FfmpegWin64Build {
    /** `YYYY-MM-DD` of the release; used to name (and de-duplicate) the cached binary. */
    versionId: string;
    /** The zip that holds `bin/ffmpeg.exe` and `bin/ffprobe.exe`. */
    downloadUrl: string;
}

/** Look up the latest Windows x64 GPL build (ffmpeg and ffprobe ship in the same archive). */
export async function getLatestWin64Build(userAgent: string): Promise<FfmpegWin64Build> {
    const apiUrl = `https://api.github.com/repos/${FFMPEG_BUILDS_REPO}/releases/latest`;
    const release = await httpsGetJson<GitHubRelease>(apiUrl, { userAgent });

    const published = release.published_at ? new Date(release.published_at) : null;
    if (!release.tag_name || !published || Number.isNaN(published.getTime())) {
        throw new Error(`Unexpected release metadata from ${apiUrl} (no tag_name / published_at)`);
    }

    return {
        versionId: published.toISOString().split("T")[0],
        downloadUrl: `https://github.com/${FFMPEG_BUILDS_REPO}/releases/download/${release.tag_name}/${WIN64_ARCHIVE}`,
    };
}
