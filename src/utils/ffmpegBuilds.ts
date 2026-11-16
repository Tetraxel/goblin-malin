import { httpsGetJson } from "./http";

/**
 * Where the Windows ffmpeg/ffprobe binaries come from. `BtbN/FFmpeg-Builds` moved to the
 * `FFmpeg-Builds` organisation: GitHub still answers `301` for the old name (which the http
 * helper follows), but pointing at the real location saves a hop and survives that redirect
 * being dropped one day. Both ffmpeg-setup.ts and ffprobe-setup.ts read it from here, so a
 * future move is a one-line change.
 */
export const FFMPEG_BUILDS_REPO = "FFmpeg-Builds/FFmpeg-Builds";
/** The development branch: used only when the release has no stable-branch build to offer. */
const MASTER_ARCHIVE = "ffmpeg-master-latest-win64-gpl.zip";
/** `ffmpeg-n9.0-latest-win64-gpl-9.0.zip`: the newest build of a numbered (stable) branch of ffmpeg. */
const STABLE_ARCHIVE = /^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-\1\.\2\.zip$/;

interface GitHubRelease {
    tag_name?: string;
    published_at?: string;
    assets?: { name?: string }[];
}

/**
 * The archive to install: the newest stable branch of ffmpeg when the release has one, else the development branch.
 * A stable branch only gets fixes, so what works today keeps working; master is whatever was committed last night.
 */
export function pickWin64Archive(assetNames: readonly string[]): { name: string; branch?: string } {
    let best: { name: string; branch: string; major: number; minor: number } | undefined;
    for (const name of assetNames) {
        const match = STABLE_ARCHIVE.exec(name);
        if (!match) continue;
        const major = Number(match[1]);
        const minor = Number(match[2]);
        if (!best || major > best.major || (major === best.major && minor > best.minor)) {
            best = { name, branch: `n${major}.${minor}`, major, minor };
        }
    }
    return best ? { name: best.name, branch: best.branch } : { name: MASTER_ARCHIVE };
}

export interface FfmpegWin64Build {
    /**
     * Names (and de-duplicates) the cached binary: the branch and the month for a stable build (`n9.0-2026-11`: it is
     * downloaded again once a month, not on every daily rebuild), the date of the release for a development build.
     */
    versionId: string;
    /** The zip that holds `bin/ffmpeg.exe` and `bin/ffprobe.exe`. */
    downloadUrl: string;
    /** The file name of that zip, as it appears in the checksum list. */
    archiveName: string;
    /** The `sha256sum`-style list the vendor publishes next to the zip. */
    checksumsUrl: string;
}

/** Look up the latest Windows x64 GPL build (ffmpeg and ffprobe ship in the same archive). */
export async function getLatestWin64Build(userAgent: string): Promise<FfmpegWin64Build> {
    const apiUrl = `https://api.github.com/repos/${FFMPEG_BUILDS_REPO}/releases/latest`;
    const release = await httpsGetJson<GitHubRelease>(apiUrl, { userAgent });

    const published = release.published_at ? new Date(release.published_at) : null;
    if (!release.tag_name || !published || Number.isNaN(published.getTime())) {
        throw new Error(`Unexpected release metadata from ${apiUrl} (no tag_name / published_at)`);
    }

    const archive = pickWin64Archive((release.assets ?? []).map((asset) => asset.name ?? ""));
    const day = published.toISOString().split("T")[0];
    const releaseUrl = `https://github.com/${FFMPEG_BUILDS_REPO}/releases/download/${release.tag_name}`;
    return {
        versionId: archive.branch ? `${archive.branch}-${day.slice(0, 7)}` : day,
        downloadUrl: `${releaseUrl}/${archive.name}`,
        archiveName: archive.name,
        checksumsUrl: `${releaseUrl}/checksums.sha256`,
    };
}
