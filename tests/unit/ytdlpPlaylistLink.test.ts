import { beforeEach, describe, expect, test, vi } from "vitest";
import { YtDlpService } from "#flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService";
import { YoutubeService } from "#flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService";
import { globalLogger } from "#base/logger/logger";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { makeTrack, meta } from "./helpers/agentWorld";

// A link copied from the address bar while a playlist or a mix plays: `watch?v=<id>&list=<playlist>&index=7`. yt-dlp
// treats such a URL as the playlist unless it is told not to, and the track file would hold the playlist's first video.

const calls = vi.hoisted(() => ({
    url: undefined as string | undefined,
    options: undefined as { noPlaylist?: boolean } | undefined,
}));

vi.mock("#flows/musicDownloadFlow/services/apis/ytdlp-client", () => ({
    getYtDlpClient: async () => ({
        download: (url: string, options: { noPlaylist?: boolean }) => {
            calls.url = url;
            calls.options = options;
            const handle: { on: () => unknown; kill: () => undefined; run: () => Promise<void> } = {
                on: () => handle,
                kill: () => undefined,
                // Nothing is downloaded here: the call is all this test looks at.
                run: async () => {
                    throw new Error("stop here");
                },
            };
            return handle;
        },
    }),
}));

const PASTED = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz123&index=7";

describe("a YouTube link that belongs to a playlist", () => {
    beforeEach(() => {
        calls.url = undefined;
        calls.options = undefined;
    });

    test("yt-dlp is told to take the video only, not the playlist", async () => {
        const track: TrackMetadata = { ...meta("dQw4w9WgXcQ", "Song", "Artist", "youtube"), url: PASTED };
        const service = new YtDlpService(makeTrack("t", "Song"), globalLogger);
        await service.downloadTrack(track).catch(() => undefined);
        expect(calls.options?.noPlaylist).toBe(true);
    });

    test("the metadata of a YouTube track carries the video's own page, not the pasted link", async () => {
        const service = Object.create(YoutubeService.prototype) as YoutubeService;
        (service as unknown as { getSong: () => Promise<unknown> }).getSong = async () => ({
            videoId: "dQw4w9WgXcQ",
            name: "Song",
            duration: 200,
        });
        const track = await service.getTrackMetadata(PASTED);
        expect(track.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        expect(track.url).not.toContain("list=");
    });
});
