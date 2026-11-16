import { describe, expect, test } from "vitest";
import { withoutBusy } from "#flows/musicDownloadFlow/utils/busyTasks";

// An album, playlist or group is deleted or archived whole, or not at all: never its idle tracks from under a running one.

type Fake = { getId(): string; isBusy(): boolean; getAttributes(): unknown };

const track = (id: string, busy = false): Fake => ({
    getId: () => id,
    isBusy: () => busy,
    getAttributes: () => ({ kind: "track" }),
});
const collection = (id: string, childTaskIds: string[], busy = false): Fake => ({
    getId: () => id,
    isBusy: () => busy,
    getAttributes: () => ({ kind: "collection", childTaskIds }),
});

function select(all: Fake[], ids: string[]): string[] {
    const byId = new Map(all.map((t) => [t.getId(), t]));
    const requested = ids.map((id) => byId.get(id)!);
    return withoutBusy(requested, (id) => byId.get(id)).map((t) => t.getId());
}

describe("withoutBusy", () => {
    test("idle tasks all go", () => {
        const all = [track("a"), track("b")];
        expect(select(all, ["a", "b"])).toEqual(["a", "b"]);
    });

    test("a busy track alone is skipped, the others go", () => {
        const all = [track("a"), track("b", true), track("c")];
        expect(select(all, ["a", "b", "c"])).toEqual(["a", "c"]);
    });

    test("an album with a running track is kept whole, with all its tracks", () => {
        const all = [
            collection("album", ["t1", "t2", "t3"]),
            track("t1"),
            track("t2", true),
            track("t3"),
            track("solo"),
        ];
        expect(select(all, ["album", "t1", "t2", "t3", "solo"])).toEqual(["solo"]);
    });

    test("a running track the caller did not list still keeps its album", () => {
        const all = [collection("album", ["t1", "t2"]), track("t1"), track("t2", true)];
        expect(select(all, ["album", "t1"])).toEqual([]);
    });

    test("an album that is itself busy (fetching its track list) is kept whole", () => {
        const all = [collection("album", ["t1"], true), track("t1")];
        expect(select(all, ["album", "t1"])).toEqual([]);
    });

    test("an idle album goes with its tracks", () => {
        const all = [collection("album", ["t1", "t2"]), track("t1"), track("t2")];
        expect(select(all, ["album", "t1", "t2"])).toEqual(["album", "t1", "t2"]);
    });
});
