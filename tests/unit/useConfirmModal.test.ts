import { describe, expect, test } from "vitest";
import { useConfirmModal, type ConfirmModalConfig } from "../../src/components/ConfirmModal/useConfirmModal";
import { mountHook, tick } from "./helpers/mountHook";

type Modal = ReturnType<typeof useConfirmModal>;

/** Mounts the hook and returns an accessor for its latest value. */
function mountModal(): { current: () => Modal } {
    return mountHook(() => useConfirmModal(), undefined);
}

const dialog = (title: string, log: string[] = []): ConfirmModalConfig => ({
    title,
    message: title,
    choices: [{ label: "OK", color: "white" }],
    accentColor: "white",
    onConfirm: () => log.push(`${title}:confirm`),
    onCancel: () => log.push(`${title}:cancel`),
});

describe("useConfirmModal", () => {
    test("openConfirmModal still replaces whatever is open (unchanged behaviour)", async () => {
        const host = mountModal();
        host.current().openConfirmModal(dialog("first"));
        host.current().openConfirmModal(dialog("second"));
        await tick();
        expect(host.current().pendingConfig?.title).toBe("second");
    });

    test("openConfirmModalWhenFree shows at once when nothing is open", async () => {
        const host = mountModal();
        host.current().openConfirmModalWhenFree(dialog("alert"));
        await tick();
        expect(host.current().pendingConfig?.title).toBe("alert");
    });

    test("openConfirmModalWhenFree waits for an open dialog instead of replacing it", async () => {
        const host = mountModal();
        host.current().openConfirmModal(dialog("question"));
        await tick();

        host.current().openConfirmModalWhenFree(dialog("alert"));
        await tick();
        expect(host.current().pendingConfig?.title).toBe("question");

        host.current().handleConfirm(0);
        await tick();
        expect(host.current().pendingConfig?.title).toBe("alert");

        host.current().handleConfirm(0);
        await tick();
        expect(host.current().pendingConfig).toBeNull();
    });

    test("waiting dialogs appear in the order they were requested, also after a cancel", async () => {
        const host = mountModal();
        const log: string[] = [];
        host.current().openConfirmModal(dialog("question", log));
        host.current().openConfirmModalWhenFree(dialog("a", log));
        host.current().openConfirmModalWhenFree(dialog("b", log));
        await tick();

        host.current().handleCancel();
        await tick();
        expect(host.current().pendingConfig?.title).toBe("a");
        host.current().handleConfirm(0);
        await tick();
        expect(host.current().pendingConfig?.title).toBe("b");
        host.current().handleConfirm(0);
        await tick();
        expect(host.current().pendingConfig).toBeNull();
        expect(log).toEqual(["question:cancel", "a:confirm", "b:confirm"]);
    });

    test("a dialog opened by a waiting request is itself protected from the next one", async () => {
        const host = mountModal();
        host.current().openConfirmModalWhenFree(dialog("a"));
        host.current().openConfirmModalWhenFree(dialog("b")); // same tick: "a" has not rendered yet
        await tick();
        expect(host.current().pendingConfig?.title).toBe("a");
    });
});
