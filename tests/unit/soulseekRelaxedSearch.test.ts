import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { FileAttribute, type SearchResult } from "slsk-client";

// "Song - 2011 Remaster" is not in a file's path: Soulseek wants every word, so a second, shorter search is made.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-slsk-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const { SoulseekService } =
    await import("#flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService");
const { Task } = await import("#base/task/task");
const { globalLogger } = await import("#base/logger/logger");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const track = {
    uri: "spotify::track::abc",
    trackName: "Song - 2011 Remaster",
    artists: [{ name: "Artist" }],
    duration: 200_000,
} as never;

function service() {
    const task = new Task({ id: "t1", attributes: { downloadSources: [] } as never, logger: globalLogger });
    // What a DownloadTask adds: the temp files of its own rows, which a new search clears first.
    Object.assign(task, { ownTempFiles: () => new Set<string>() });
    return new SoulseekService(task as never, globalLogger);
}

const result = (file: string): SearchResult => ({
    user: "peer",
    file: `@@peer\\Music\\${file}`,
    size: 30 * 1024 * 1024,
    slots: true,
    speed: 500,
    attribs: { [FileAttribute.Bitrate]: 1000 },
});

/** The two methods that talk to the network, which a test replaces on its own service. */
type Network = {
    searchOnce: (query: string, timeoutMs: number) => Promise<SearchResult[]>;
    downloadCandidate: () => Promise<void>;
};
const network = (instance: unknown) => instance as Network;

describe("the Soulseek search", () => {
    test("is made again with a shorter title when nothing usable came back", async () => {
        const instance = service();
        const queries: string[] = [];
        network(instance).searchOnce = async (query) => {
            queries.push(query);
            // Only the shorter query finds anything; the download that follows is not what is tested.
            return query.includes("2011") ? [] : [result("Artist - Song.flac")];
        };
        network(instance).downloadCandidate = async () => {
            throw new Error("not under test");
        };

        await instance.downloadTrack(track, undefined, undefined, { maxDownloads: 1 }).catch(() => undefined);

        expect(queries.slice(0, 2)).toEqual(["Artist Song 2011 Remaster .flac", "Artist Song .flac"]);
    });

    test("is not repeated when the title has nothing to take off", async () => {
        const instance = service();
        const queries: string[] = [];
        network(instance).searchOnce = async (query) => {
            queries.push(query);
            return [];
        };

        await instance
            .downloadTrack({ ...(track as object), trackName: "Plain Song" } as never, undefined, undefined, {
                maxDownloads: 1,
            })
            .catch(() => undefined);

        // One search per format (flac, then the mp3 fallback), no second one with the same words.
        expect(queries).toEqual(["Artist Plain Song .flac", "Artist Plain Song .mp3"]);
    });

    test("with no result at either length, both are tried before the next format", async () => {
        const instance = service();
        const queries: string[] = [];
        network(instance).searchOnce = async (query) => {
            queries.push(query);
            return [];
        };

        await instance.downloadTrack(track, undefined, undefined, { maxDownloads: 1 }).catch(() => undefined);

        expect(queries).toEqual([
            "Artist Song 2011 Remaster .flac",
            "Artist Song .flac",
            "Artist Song 2011 Remaster .mp3",
            "Artist Song .mp3",
        ]);
    });
});
