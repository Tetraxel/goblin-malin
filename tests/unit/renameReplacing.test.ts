import * as fs from "fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renameReplacing } from "#utils/dataFile";

const errno = (code: string) => Object.assign(new Error(code), { code });

afterEach(() => vi.restoreAllMocks());

describe("renameReplacing", () => {
    test("retries while the target is briefly locked, then succeeds", async () => {
        const rename = vi
            .spyOn(fs.promises, "rename")
            .mockRejectedValueOnce(errno("EPERM"))
            .mockRejectedValueOnce(errno("EBUSY"))
            .mockResolvedValueOnce(undefined);

        await expect(renameReplacing("a.tmp", "a", [1, 1, 1])).resolves.toBeUndefined();
        expect(rename).toHaveBeenCalledTimes(3);
    });

    test("gives up after the last retry with the original error", async () => {
        const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(errno("EACCES"));

        await expect(renameReplacing("a.tmp", "a", [1, 1])).rejects.toMatchObject({ code: "EACCES" });
        expect(rename).toHaveBeenCalledTimes(3);
    });

    test("does not retry errors that waiting won't fix", async () => {
        const rename = vi.spyOn(fs.promises, "rename").mockRejectedValue(errno("ENOSPC"));

        await expect(renameReplacing("a.tmp", "a", [1, 1])).rejects.toMatchObject({ code: "ENOSPC" });
        expect(rename).toHaveBeenCalledTimes(1);
    });
});
