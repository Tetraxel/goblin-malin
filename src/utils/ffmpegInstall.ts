import * as path from "path";
import { getBinDir } from "./appPaths";
import { installFromZip } from "./binaryArchive";
import type { FfmpegWin64Build } from "./ffmpegBuilds";

/** Name of a cached ffmpeg / ffprobe binary for a given build (`ffmpeg_2026-11-08.exe`). */
export function versionedBinaryName(tool: "ffmpeg" | "ffprobe", versionId: string): string {
    return `${tool}_${versionId}${process.platform === "win32" ? ".exe" : ""}`;
}

/**
 * The Windows archive holds both `bin/ffmpeg.exe` and `bin/ffprobe.exe` (~200 MB). Whichever of the two
 * asks first extracts both, so the other finds its binary already installed instead of downloading the
 * same archive again.
 */
export function installWin64Archive(build: FfmpegWin64Build, userAgent: string): Promise<void> {
    return installFromZip(
        {
            url: build.downloadUrl,
            // A hyphen, so it is never picked up by findExistingBinary()/cleanupOldVersions() ("ffmpeg_" prefix).
            tempName: "ffmpeg-download.zip",
            userAgent,
            checksumsUrl: build.checksumsUrl,
            archiveName: build.archiveName,
        },
        [
            {
                entrySuffix: "bin/ffmpeg.exe",
                destPath: path.join(getBinDir(), versionedBinaryName("ffmpeg", build.versionId)),
            },
            {
                entrySuffix: "bin/ffprobe.exe",
                destPath: path.join(getBinDir(), versionedBinaryName("ffprobe", build.versionId)),
            },
        ]
    );
}
