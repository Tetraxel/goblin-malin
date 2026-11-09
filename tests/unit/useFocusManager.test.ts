import { describe, expect, test } from "vitest";
import { useFocusManager } from "../../src/hooks/useFocusManager";
import { mountHook, tick } from "./helpers/mountHook";

type Props = Parameters<typeof useFocusManager>[0];
const baseProps: Props = {
    toolbarButtonCount: 5,
    taskIds: ["t1", "t2", "t3"],
    taskColumnCount: 4,
    primaryMode: "metadata",
    onPrimaryModeChange: () => {},
};

function mount(overrides: Partial<Props> = {}) {
    const host = mountHook(useFocusManager, { ...baseProps, ...overrides });
    /** Calls an action, then lets React apply the state update. */
    const act = async (fn: (focus: ReturnType<typeof useFocusManager>) => void) => {
        fn(host.current());
        await tick();
    };
    return { ...host, act, state: () => host.current().focusState };
}

describe("useFocusManager: windows", () => {
    test("starts on the toolbar", () => {
        const host = mount();
        expect(host.state().activeWindow).toBe("toolbar");
        expect(host.state().previousWindow).toBeUndefined();
    });

    test("switchWindow remembers where it came from and switchBack returns there", async () => {
        const host = mount();
        await host.act((f) => f.switchWindow("settingsModal"));
        expect(host.state().activeWindow).toBe("settingsModal");
        expect(host.state().previousWindow).toBe("toolbar");

        await host.act((f) => f.switchBack());
        expect(host.state().activeWindow).toBe("toolbar");
        expect(host.state().returningFromWindow).toBe("settingsModal");
    });

    test("switching to the window that is already active keeps the real previous window", async () => {
        const host = mount();
        await host.act((f) => f.switchWindow("taskList"));
        await host.act((f) => f.switchWindow("taskList"));
        expect(host.state().previousWindow).toBe("toolbar");
        await host.act((f) => f.switchBack());
        expect(host.state().activeWindow).toBe("toolbar");
    });

    test("switchBack with nowhere to go lands on the first toolbar button", async () => {
        const host = mount();
        await host.act((f) => f.moveToolbarSelection("right"));
        await host.act((f) => f.switchBack());
        expect(host.state().activeWindow).toBe("toolbar");
        expect(host.state().toolbar.selectedButtonIndex).toBe(0);
    });

    test("Tab flips between the task list and the lower panel; the toolbar is not in the cycle", async () => {
        const host = mount();
        await host.act((f) => f.handleTabPress());
        expect(host.state().activeWindow).toBe("taskList");
        await host.act((f) => f.handleTabPress());
        expect(host.state().activeWindow).toBe("secondaryPanel");
        await host.act((f) => f.handleTabPress());
        expect(host.state().activeWindow).toBe("taskList");
    });
});

describe("useFocusManager: toolbar", () => {
    test("moves between buttons and stops at both ends", async () => {
        const host = mount({ toolbarButtonCount: 3 });
        await host.act((f) => f.moveToolbarSelection("left"));
        expect(host.state().toolbar.selectedButtonIndex).toBe(0);
        for (let i = 0; i < 5; i++) await host.act((f) => f.moveToolbarSelection("right"));
        expect(host.state().toolbar.selectedButtonIndex).toBe(2);
    });

    test("down leaves the toolbar for the task list header", async () => {
        const host = mount();
        await host.act((f) => f.moveToolbarSelection("down"));
        expect(host.state().activeWindow).toBe("taskList");
        expect(host.state().taskList.isHeaderFocused).toBe(true);
    });

    test("selectToolbarButton (pointer) focuses the toolbar on that button", async () => {
        const host = mount();
        await host.act((f) => f.switchWindow("taskList"));
        await host.act((f) => f.selectToolbarButton(3));
        expect(host.state().activeWindow).toBe("toolbar");
        expect(host.state().toolbar.selectedButtonIndex).toBe(3);
    });
});

describe("useFocusManager: task list cursor", () => {
    const onList = async (overrides: Partial<Props> = {}) => {
        const host = mount(overrides);
        await host.act((f) => f.switchWindow("taskList"));
        return host;
    };

    test("down walks the rows and stops on the last one", async () => {
        const host = await onList();
        for (let i = 0; i < 6; i++) await host.act((f) => f.moveTaskSelection("down"));
        expect(host.state().taskList.selectedTaskIndex).toBe(2);
    });

    test("up from the first row focuses the header, and up again goes on to the toolbar", async () => {
        const host = await onList();
        await host.act((f) => f.moveTaskSelection("up"));
        expect(host.state().taskList.isHeaderFocused).toBe(true);
        await host.act((f) => f.moveTaskSelection("up"));
        expect(host.state().activeWindow).toBe("toolbar");
    });

    test("down from the header goes back to the first row", async () => {
        const host = await onList();
        await host.act((f) => f.moveTaskSelection("down"));
        await host.act((f) => f.moveTaskSelection("up"));
        await host.act((f) => f.moveTaskSelection("up"));
        expect(host.state().taskList.isHeaderFocused).toBe(true);
        await host.act((f) => f.moveTaskSelection("down"));
        expect(host.state().taskList.isHeaderFocused).toBe(false);
        expect(host.state().taskList.selectedTaskIndex).toBe(0);
    });

    test("with no tasks, down from the header stays on the header", async () => {
        const host = await onList({ taskIds: [] });
        await host.act((f) => f.moveTaskSelection("up"));
        expect(host.state().taskList.isHeaderFocused).toBe(true);
        await host.act((f) => f.moveTaskSelection("down"));
        expect(host.state().taskList.isHeaderFocused).toBe(true);
    });

    test("left and right move between columns and stop at the ends", async () => {
        const host = await onList({ taskColumnCount: 3 });
        for (let i = 0; i < 5; i++) await host.act((f) => f.moveTaskSelection("right"));
        expect(host.state().taskList.selectedColumnIndex).toBe(2);
        for (let i = 0; i < 5; i++) await host.act((f) => f.moveTaskSelection("left"));
        expect(host.state().taskList.selectedColumnIndex).toBe(0);
    });

    test("a smaller column set pulls the selected column back into range", async () => {
        const host = await onList({ taskColumnCount: 4 });
        await host.act((f) => f.moveTaskSelection("right"));
        expect(host.state().taskList.selectedColumnIndex).toBe(3);
        host.rerender({ ...baseProps, taskColumnCount: 2 });
        await tick();
        expect(host.state().taskList.selectedColumnIndex).toBe(1);
    });

    test("removing the selected last task clamps the cursor and drops its multi-selection", async () => {
        const host = await onList();
        for (let i = 0; i < 2; i++) await host.act((f) => f.moveTaskSelection("down"));
        await host.act((f) => f.toggleTaskSelection("t3"));
        expect([...host.state().taskList.selectedTaskIds]).toEqual(["t3"]);

        host.rerender({ ...baseProps, taskIds: ["t1", "t2"] });
        await tick();
        expect(host.state().taskList.selectedTaskIndex).toBe(1);
        expect(host.state().taskList.selectedTaskIds.size).toBe(0);
    });
});

describe("useFocusManager: multi-selection", () => {
    test("toggle adds and removes, select-all takes every task, clear empties", async () => {
        const host = mount();
        await host.act((f) => f.toggleTaskSelection("t1"));
        await host.act((f) => f.toggleTaskSelection("t2"));
        expect([...host.state().taskList.selectedTaskIds].sort()).toEqual(["t1", "t2"]);
        await host.act((f) => f.toggleTaskSelection("t1"));
        expect([...host.state().taskList.selectedTaskIds]).toEqual(["t2"]);

        await host.act((f) => f.selectAllTasks(["t1", "t2", "t3"]));
        expect(host.state().taskList.selectedTaskIds.size).toBe(3);
        await host.act((f) => f.clearSelection());
        expect(host.state().taskList.selectedTaskIds.size).toBe(0);
    });
});

describe("useFocusManager: panels", () => {
    test("resizePanels grows and shrinks the task list by 2 rows, within limits", async () => {
        const host = mount();
        const start = host.state().layout.taskListHeight;
        await host.act((f) => f.resizePanels("grow"));
        expect(host.state().layout.taskListHeight).toBe(start + 2);
        await host.act((f) => f.resizePanels("shrink"));
        expect(host.state().layout.taskListHeight).toBe(start);

        for (let i = 0; i < 20; i++) await host.act((f) => f.resizePanels("shrink"));
        expect(host.state().layout.taskListHeight).toBe(5);
        for (let i = 0; i < 20; i++) await host.act((f) => f.resizePanels("grow"));
        const { taskListHeight, secondaryPanelHeight, contentHeight } = host.state().layout;
        expect(secondaryPanelHeight).toBeGreaterThanOrEqual(5);
        expect(taskListHeight + secondaryPanelHeight).toBe(contentHeight);
    });

    test("switching the primary mode reports it and moves the sources tab with it, except on Logs", async () => {
        const modes: string[] = [];
        const host = mount({ onPrimaryModeChange: (m) => void modes.push(m) });
        await host.act((f) => f.setPrimaryMode("download"));
        expect(modes).toEqual(["download"]);
        expect(host.state().secondaryPanel.subTab).toBe("downloadSources");

        await host.act((f) => f.setSecondaryTab("logs"));
        await host.act((f) => f.setPrimaryMode("metadata"));
        expect(host.state().secondaryPanel.subTab).toBe("logs");
    });
});
