import { beforeEach, describe, expect, test } from "vitest";
import { notificationScheduler } from "#base/notificationScheduler";
import { StatusType, TaskStatus } from "#base/task/task-status";

beforeEach(() => notificationScheduler.setSyncMode(true));

const stage = { type: StatusType.Processing, message: "Discovering on other platforms", timeTracking: true };
const download = { type: StatusType.Processing, message: "Searching downloads", timeTracking: true };

describe("the status of a stage", () => {
    test("shows between the services' own statuses, instead of 'No status'", () => {
        const status = new TaskStatus();
        status.setFallback("discovery", stage);
        expect(status.get()).toMatchObject({ type: StatusType.Processing, message: "Discovering on other platforms" });

        // A service reports, then clears its status when it is done: the stage shows again.
        status.set({ type: StatusType.Processing, message: "Searching Spotify" });
        expect(status.get().message).toBe("Searching Spotify");
        status.clear();
        expect(status.get().message).toBe("Discovering on other platforms");
        // Its clock was not restarted by the clear.
        expect(status.get().startTime).toBeInstanceOf(Date);
    });

    test("is gone when the stage ends, and what a service left on the row stays", () => {
        const done = new TaskStatus();
        done.setFallback("discovery", stage);
        done.setFallback("discovery", undefined);
        expect(done.get().type).toBe(StatusType.NoStatus);

        const failed = new TaskStatus();
        failed.setFallback("discovery", stage);
        failed.set({ type: StatusType.Error, message: "Primary metadata unavailable" });
        failed.setFallback("discovery", undefined);
        expect(failed.get()).toMatchObject({ type: StatusType.Error, message: "Primary metadata unavailable" });
        // ...and clearing it afterwards shows nothing, not a stage that is over.
        failed.clear();
        expect(failed.get().type).toBe(StatusType.NoStatus);
    });

    test("does not hide a status that is already there when the stage starts", () => {
        const status = new TaskStatus();
        status.set({ type: StatusType.Pending, message: "Queued" });
        status.setFallback("discovery", stage);
        expect(status.get().message).toBe("Queued");
        status.clear();
        expect(status.get().message).toBe("Discovering on other platforms");
    });

    describe("two stages at once on one track", () => {
        test("the one that began last shows, and the first to end does not take the other's label away", () => {
            const status = new TaskStatus();
            status.setFallback("discovery", stage);
            status.setFallback("downloads", download);
            expect(status.get().message).toBe("Searching downloads");

            // The older stage ends first: the row keeps the newer one.
            status.setFallback("discovery", undefined);
            expect(status.get().message).toBe("Searching downloads");
            status.clear();
            expect(status.get().message).toBe("Searching downloads");

            status.setFallback("downloads", undefined);
            expect(status.get().type).toBe(StatusType.NoStatus);
        });

        test("the newer stage ending gives the row back to the older one", () => {
            const status = new TaskStatus();
            status.setFallback("discovery", stage);
            status.setFallback("downloads", download);
            status.setFallback("downloads", undefined);
            expect(status.get().message).toBe("Discovering on other platforms");
            status.setFallback("discovery", undefined);
            expect(status.get().type).toBe(StatusType.NoStatus);
        });

        test("starting a stage again replaces its own label", () => {
            const status = new TaskStatus();
            status.setFallback("discovery", stage);
            status.setFallback("discovery", { ...stage, message: "Discovering again" });
            expect(status.get().message).toBe("Discovering again");
            status.setFallback("discovery", undefined);
            expect(status.get().type).toBe(StatusType.NoStatus);
        });
    });
});
