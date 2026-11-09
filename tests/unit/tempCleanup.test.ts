import { describe, expect, test } from "vitest";
import {
    ACTIVE_FILE_GUARD_MS,
    AUTO_CLEAN_AGE,
    TEMP_AGES,
    TempUseGroup,
    buildTempUseIndex,
    findTempAge,
    selectTempGroups,
    summarizeByAge,
} from "#flows/musicDownloadFlow/utils/tempCleanup";
import { markMissingInSnapshot } from "#flows/musicDownloadFlow/utils/missingLocalFiles";
import { TempGroup, tempFileStem } from "#flows/musicDownloadFlow/utils/tempDownloads";

// Which temporary downloads may go. The rule these pin: a file is kept while a session that points at it was used
// recently — however old the session or the file is — and a file nobody points at is judged by its own age.

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const ago = (ms: number) => NOW - ms;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fileName = (n: number, ext = "flac") => `YtDlp YOUTUBE-TRACK-abc ${uuid(n)}.${ext}`;
const filePath = (n: number) => `C:\\tmp\\${fileName(n)}`;

function group(n: number, mtimeAgo: number, bytes = 100): TempGroup {
    return {
        stem: tempFileStem(fileName(n))!,
        files: [{ path: filePath(n), bytes, mtimeMs: ago(mtimeAgo) }],
        bytes,
        mtimeMs: ago(mtimeAgo),
    };
}

/** A session (or the live queue) whose tasks point at the given temp files. */
function session(files: number[], usedAgo: number, live = false): TempUseGroup {
    return {
        lastUsedMs: ago(usedAgo),
        live,
        snapshots: files.map((n) => ({
            attributes: { kind: "track", downloadSources: [{ localFile: { state: "found", path: filePath(n) } }] },
        })),
    };
}

const age = (key: string) => findTempAge(key);
const stems = (groups: TempGroup[]) => groups.map((g) => g.stem);

describe("selectTempGroups", () => {
    test("a file nobody points at goes once it is older than the age, by its own write time", () => {
        const index = buildTempUseIndex([]);
        const groups = [group(1, 10 * DAY), group(2, 2 * DAY)];
        expect(stems(selectTempGroups(groups, index, age("7d"), NOW))).toEqual([groups[0].stem]);
        expect(stems(selectTempGroups(groups, index, age("1d"), NOW))).toEqual(stems(groups));
    });

    test("a file of a session used recently stays, even if the session and the file are both old", () => {
        // The session was created long ago (its file is 60 days old) but opened yesterday.
        const index = buildTempUseIndex([session([1], 1 * DAY)]);
        const groups = [group(1, 60 * DAY)];
        expect(selectTempGroups(groups, index, age("7d"), NOW)).toEqual([]);
        // …until the session has gone unused for long enough.
        expect(stems(selectTempGroups(groups, index, age("12h"), NOW))).toEqual(stems(groups));
    });

    test("a file of a session unused for a long time goes", () => {
        const index = buildTempUseIndex([session([1], 40 * DAY)]);
        expect(stems(selectTempGroups([group(1, 40 * DAY)], index, age("14d"), NOW))).toHaveLength(1);
    });

    test("a file shared by two sessions is kept by the more recently used one", () => {
        const index = buildTempUseIndex([session([1], 50 * DAY), session([1], 2 * DAY)]);
        expect(selectTempGroups([group(1, 50 * DAY)], index, age("7d"), NOW)).toEqual([]);
    });

    test("archived and live tasks count like any other: the open session is never cleaned under the user", () => {
        const index = buildTempUseIndex([session([1], 90 * DAY, true)]);
        expect(selectTempGroups([group(1, 90 * DAY)], index, age("12h"), NOW)).toEqual([]);
    });

    test("'Everything' deletes the open session's files too, but still not what was just written", () => {
        const index = buildTempUseIndex([session([1], 90 * DAY, true)]);
        const groups = [group(1, 90 * DAY), group(2, ACTIVE_FILE_GUARD_MS / 2)];
        expect(stems(selectTempGroups(groups, index, age("all"), NOW))).toEqual([groups[0].stem]);
    });

    test("a file written minutes ago is never touched, whatever the age", () => {
        const index = buildTempUseIndex([]);
        const fresh = group(1, ACTIVE_FILE_GUARD_MS - 1000);
        for (const a of TEMP_AGES) expect(selectTempGroups([fresh], index, a, NOW)).toEqual([]);
    });

    test("a relocated source (a file that is not an app temp file) points at nothing", () => {
        const index = buildTempUseIndex([
            {
                lastUsedMs: ago(0),
                live: true,
                snapshots: [
                    { attributes: { downloadSources: [{ localFile: { state: "found", path: "D:\\Music\\a.flac" } }] } },
                ],
            },
        ]);
        expect(index.size).toBe(0);
    });

    test("the automatic clean-up is 48 hours", () => {
        const index = buildTempUseIndex([session([1], 1 * DAY), session([2], 3 * DAY)]);
        const groups = [group(1, 5 * DAY), group(2, 5 * DAY), group(3, 5 * DAY)];
        expect(AUTO_CLEAN_AGE.ms).toBe(48 * 3600 * 1000);
        expect(stems(selectTempGroups(groups, index, AUTO_CLEAN_AGE, NOW))).toEqual([groups[1].stem, groups[2].stem]);
    });
});

describe("summarizeByAge", () => {
    test("reports, for every offered age, how much would go (more for shorter ages)", () => {
        const index = buildTempUseIndex([]);
        const groups = [group(1, 40 * DAY, 10), group(2, 10 * DAY, 20), group(3, 2 * DAY, 40)];
        const byKey = Object.fromEntries(summarizeByAge(groups, index, NOW).map((s) => [s.age.key, s]));
        expect(byKey["all"]).toMatchObject({ files: 3, bytes: 70 });
        expect(byKey["1d"]).toMatchObject({ files: 3, bytes: 70 });
        expect(byKey["7d"]).toMatchObject({ files: 2, bytes: 30 });
        expect(byKey["1mo"]).toMatchObject({ files: 1, bytes: 10 });
        expect(byKey["6mo"]).toMatchObject({ files: 0, bytes: 0 });
        expect(byKey["all"].liveFiles).toBe(0);
    });

    test("tells how many of the files belong to the session open now", () => {
        const index = buildTempUseIndex([session([1, 2], 90 * DAY, true)]);
        const groups = [group(1, 40 * DAY), group(2, 40 * DAY), group(3, 40 * DAY)];
        const byKey = Object.fromEntries(summarizeByAge(groups, index, NOW).map((s) => [s.age.key, s]));
        expect(byKey["all"]).toMatchObject({ files: 3, liveFiles: 2 });
        expect(byKey["7d"]).toMatchObject({ files: 1, liveFiles: 0 }); // the open session's files are never offered
    });
});

describe("findTempAge", () => {
    test("falls back to 7 days for an unknown or missing key", () => {
        expect(findTempAge("nope").key).toBe("7d");
        expect(findTempAge(undefined).key).toBe("7d");
        expect(findTempAge("12h").label).toBe("12 hours");
    });
});

describe("markMissingInSnapshot", () => {
    const snapshot = (state: string, p = filePath(1)) => ({
        id: "t",
        attributes: {
            kind: "track",
            downloadSources: [{ localFile: { state, path: p, name: "n" } }, { provider: "x" }],
        },
    });

    test("flips a found source whose file is gone to not_found, leaving the rest as it was", () => {
        const before = snapshot("found");
        const after = markMissingInSnapshot(before, () => true);
        expect(after).not.toBe(before);
        expect(after.attributes.downloadSources[0].localFile).toEqual({
            state: "not_found",
            path: filePath(1),
            name: "n",
        });
        expect(after.attributes.downloadSources[1]).toBe(before.attributes.downloadSources[1]);
        // The input is never modified: it may be a stored session.
        expect(before.attributes.downloadSources[0].localFile!.state).toBe("found");
    });

    test("returns the very same object when nothing changes (so callers can skip writing)", () => {
        const present = snapshot("found");
        expect(markMissingInSnapshot(present, () => false)).toBe(present);
        const alreadyMissing = snapshot("not_found");
        expect(markMissingInSnapshot(alreadyMissing, () => true)).toBe(alreadyMissing);
        const collection = { id: "c", attributes: { kind: "collection", childTaskIds: [] } };
        expect(markMissingInSnapshot(collection, () => true)).toBe(collection);
        const noAttributes: { id: string; attributes?: unknown } = { id: "x" };
        expect(markMissingInSnapshot(noAttributes, () => true)).toEqual({ id: "x" });
    });
});
