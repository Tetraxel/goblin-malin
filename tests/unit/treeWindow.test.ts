import { describe, expect, test } from "vitest";
import { computeWindow } from "#components/SecondaryPanel/DownloadPanel/DownloadSourceTree/treeWindow";

const ones = (n: number) => Array.from({ length: n }, () => 1);

describe("computeWindow", () => {
    test("shows everything when it fits", () => {
        expect(computeWindow(ones(5), 2, 0, 10)).toEqual({ start: 0, end: 5 });
    });

    test("an empty list has an empty window", () => {
        expect(computeWindow([], 0, 0, 10)).toEqual({ start: 0, end: 0 });
    });

    test("starts at the top while the cursor is near it", () => {
        expect(computeWindow(ones(30), 3, 0, 10)).toEqual({ start: 0, end: 10 });
    });

    test("scrolls just far enough to bring the cursor to the bottom edge", () => {
        expect(computeWindow(ones(30), 14, 0, 10)).toEqual({ start: 5, end: 15 });
    });

    test("does not move while the cursor stays inside the window", () => {
        expect(computeWindow(ones(30), 8, 5, 10)).toEqual({ start: 5, end: 15 });
    });

    test("scrolls up when the cursor goes above the window", () => {
        expect(computeWindow(ones(30), 4, 5, 10)).toEqual({ start: 4, end: 14 });
    });

    test("fills the box when the list ends before it does", () => {
        expect(computeWindow(ones(30), 29, 25, 10)).toEqual({ start: 20, end: 30 });
    });

    test("counts items taller than one line", () => {
        // heights: 1, 2, 1, 1, 3, 1 — a box of 5 lines with the cursor on the 3-line item (index 4).
        const heights = [1, 2, 1, 1, 3, 1];
        const { start, end } = computeWindow(heights, 4, 0, 5);
        expect(heights.slice(start, end).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5);
        expect(start).toBeLessThanOrEqual(4);
        expect(end).toBeGreaterThan(4);
    });

    test("always includes the cursor even when it is taller than the box", () => {
        const { start, end } = computeWindow([1, 1, 8], 2, 0, 5);
        expect(start).toBeLessThanOrEqual(2);
        expect(end).toBe(3);
    });
});
