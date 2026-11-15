import { beforeEach, describe, expect, test, vi } from "vitest";
import clipboard from "clipboardy";
import { buildContextualActionBar } from "#flows/musicDownloadFlow/contextualActions";
import type { ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { makeTrack, meta } from "./helpers/agentWorld";

vi.mock("clipboardy", () => ({ default: { writeSync: vi.fn(), write: vi.fn(), read: vi.fn() } }));

const columns: ColumnDefinition[] = ["toTag", "toDownload", "url", "artist", "track", "status"].map((id) => ({
    id,
    label: id,
    weight: 1,
    component: () => null,
}));
const indexOf = (id: string) => columns.findIndex((c) => c.id === id);

beforeEach(() => vi.mocked(clipboard.writeSync).mockClear());

/** A YouTube video whose channel ("Moonflower") is not the artist the platforms agree on. */
function lyricsUpload() {
    const youtube = {
        ...meta("yt1", "Patrick Sébastien - Toc toc (Lyrics)", "Moonflower", "youtube"),
    } as TrackMetadata;
    const spotify = meta("sp1", "Toc toc", "Patrick Sébastien", "spotify");
    const result = (metadata: TrackMetadata, isPrimaryInput: boolean) => ({
        metadata,
        isPrimaryInput,
        isFavorited: false,
        isRejected: false,
        rank: 0,
        discoverySources: [],
    });
    return makeTrack("t1", "x", {
        metadataGroups: [
            { platform: "youtube", serviceKey: "youtube", rank: 1, results: [result(youtube, true)] },
            { platform: "spotify", serviceKey: "spotify", rank: 0, results: [result(spotify, false)] },
        ],
    });
}

function copy(task: ReturnType<typeof lyricsUpload>, column: string): void {
    const bar = buildContextualActionBar(task, { columns, columnIndex: indexOf(column) });
    const action = bar.rows[0].actions.find((a) => a.label.startsWith("Copy"));
    expect(action, `a copy action on the ${column} column`).toBeDefined();
    action!.onClick();
}

describe("copying a cell", () => {
    test("copies what the cell shows: the compiled artist, not the uploader's channel", () => {
        copy(lyricsUpload(), "artist");
        expect(clipboard.writeSync).toHaveBeenCalledWith("Patrick Sébastien");
    });

    test("copies the compiled title too, with the user's override on top", () => {
        const task = lyricsUpload();
        copy(task, "track");
        expect(clipboard.writeSync).toHaveBeenLastCalledWith("Toc toc");

        task.setMetadataOverride({ trackName: "Toc Toc (Remix)" }, { actor: "user" });
        copy(task, "track");
        expect(clipboard.writeSync).toHaveBeenLastCalledWith("Toc Toc (Remix)");
    });
});
