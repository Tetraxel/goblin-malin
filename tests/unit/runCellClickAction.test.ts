import { describe, test, expect } from "vitest";
import { buildTrackTask } from "#flows/musicDownloadFlow/utils/buildTrackTask";
import { runCellClickAction } from "#flows/musicDownloadFlow/contextualActions";
import type { ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";

// Same ids and order as `computeColumns` (taskColumns.ts); its cell components are `.tsx` files
// the `#components/*` alias cannot load under Vitest, and the action bar only reads `id` and `label`.
const columns: ColumnDefinition[] = ["toTag", "toDownload", "url", "artist", "track", "status"].map((id) => ({
    id,
    label: id,
    weight: 1,
    component: () => null,
}));
const indexOf = (id: string) => columns.findIndex((c) => c.id === id);

describe("runCellClickAction", () => {
    test("one click on the TAG? cell toggles tagging, and again toggles it back", () => {
        const task = buildTrackTask("https://example.test/a", { toTag: true, toDownload: false });

        runCellClickAction(task, columns, indexOf("toTag"));
        expect(task.getAttributes()?.toTag).toBe(false);
        expect(task.getAttributes()?.toDownload).toBe(false);

        runCellClickAction(task, columns, indexOf("toTag"));
        expect(task.getAttributes()?.toTag).toBe(true);
    });

    test("one click on the DL? cell toggles downloading only", () => {
        const task = buildTrackTask("https://example.test/b", { toTag: true, toDownload: false });

        runCellClickAction(task, columns, indexOf("toDownload"));
        expect(task.getAttributes()?.toDownload).toBe(true);
        expect(task.getAttributes()?.toTag).toBe(true);
    });

    test("other columns have no click action: Enter's action there (open, copy…) is not run", () => {
        const task = buildTrackTask("https://example.test/c", { toTag: true, toDownload: false });

        for (const id of ["url", "artist", "track", "status"]) {
            runCellClickAction(task, columns, indexOf(id));
        }
        expect(task.getAttributes()?.toTag).toBe(true);
        expect(task.getAttributes()?.toDownload).toBe(false);
    });
});
