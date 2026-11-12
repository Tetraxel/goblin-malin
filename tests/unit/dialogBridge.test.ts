import { afterEach, describe, expect, test } from "vitest";
import { dialogBridge, type ConfirmDialog, type ListAnswer, type ListDialog } from "#base/bridges/dialogBridge";

const confirmDialog = (title: string): ConfirmDialog => ({
    title,
    message: "",
    choices: [{ label: "OK", tone: "primary" }],
});
const listDialog = (title: string): ListDialog => ({ title, items: [{ label: "a" }] });
const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => {
    dialogBridge.setListOpener(null);
    dialogBridge.setConfirmOpener(null);
});

describe("dialogBridge", () => {
    test("nobody to ask: both resolve null", async () => {
        expect(await dialogBridge.confirm(confirmDialog("x"))).toBeNull();
        expect(await dialogBridge.choose(listDialog("x"))).toBeNull();
    });

    test("one dialog at a time, in the order asked: a notice waits for the list on screen", async () => {
        const shown: string[] = [];
        const answers: { list?: (a: ListAnswer) => void; confirm?: (i: number | null) => void } = {};
        dialogBridge.setListOpener((d, resolve) => {
            shown.push(d.title);
            answers.list = resolve;
        });
        dialogBridge.setConfirmOpener((d, resolve) => {
            shown.push(d.title);
            answers.confirm = resolve;
        });

        const list = dialogBridge.choose(listDialog("which release"));
        const notice = dialogBridge.confirm(confirmDialog("a notice"));
        await tick();
        expect(shown).toEqual(["which release"]);

        answers.list!({ index: 0 });
        expect(await list).toEqual({ index: 0 });
        await tick();
        expect(shown).toEqual(["which release", "a notice"]);

        answers.confirm!(0);
        expect(await notice).toBe(0);
    });

    test("the list UI going away answers the dialog on screen and the ones waiting with null", async () => {
        dialogBridge.setListOpener(() => {
            /* shown, never answered */
        });
        const onScreen = dialogBridge.choose(listDialog("one"));
        const waiting = dialogBridge.choose(listDialog("two"));
        dialogBridge.setListOpener(null);
        expect(await onScreen).toBeNull();
        expect(await waiting).toBeNull();
    });

    test("swapping the confirm opener (a theme change) does not cancel the dialog on screen", async () => {
        let answer: ((i: number | null) => void) | undefined;
        dialogBridge.setConfirmOpener((_d, resolve) => (answer = resolve));
        const pending = dialogBridge.confirm(confirmDialog("x"));
        dialogBridge.setConfirmOpener(null);
        dialogBridge.setConfirmOpener(() => {});
        answer!(1);
        expect(await pending).toBe(1);
    });
});
