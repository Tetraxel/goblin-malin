import { afterEach, describe, expect, it } from "vitest";
import { Canvas } from "../../src/components/WelcomeModal/intro/canvas";
import { DirectPainter } from "../../src/components/WelcomeModal/intro/directPainter";

/** A stream that records what was written and calls the write callback at once, like a terminal that keeps up. */
function fakeStdout() {
    const written: string[] = [];
    const stdout = {
        write(chunk: string, callback?: () => void) {
            written.push(chunk);
            callback?.();
            return true;
        },
    };
    return { stdout: stdout as unknown as NodeJS.WritableStream, written };
}

const BEGIN_SYNC = "[?2026h";
const END_SYNC = "[?2026l";

const picture = () => {
    const canvas = new Canvas(10, 4);
    canvas.setPixel(2, 2, [255, 128, 0]);
    return canvas;
};

let painter: DirectPainter | null = null;
afterEach(() => painter?.dispose());

describe("DirectPainter", () => {
    it("writes only what changed between two identical frames", () => {
        const { stdout, written } = fakeStdout();
        painter = new DirectPainter(stdout);

        painter.paint(picture());
        painter.paint(picture());

        expect(written).toHaveLength(1);
    });

    it("puts the picture back at the end of the tick after someone else wrote to the stream", async () => {
        const { stdout, written } = fakeStdout();
        painter = new DirectPainter(stdout);
        painter.paint(picture());
        const first = written[0];

        stdout.write("[2Kink redraws the screen");
        expect(written).toHaveLength(2);
        await Promise.resolve();

        expect(written).toHaveLength(3);
        expect(written[2]).toBe(first);
    });

    it("repaints inside Ink's synchronized frame, so the wiped screen is never shown", async () => {
        const { stdout, written } = fakeStdout();
        painter = new DirectPainter(stdout);
        painter.paint(picture());
        const first = written[0];

        stdout.write(BEGIN_SYNC);
        stdout.write("[2Kink redraws the screen");
        stdout.write(END_SYNC);
        await Promise.resolve();

        // Ink's frame, then the picture, then the end marker, and nothing more once the tick is over.
        expect(written).toHaveLength(5);
        expect(written[3]).toContain(first.slice(BEGIN_SYNC.length, -END_SYNC.length));
        expect(written[3]).not.toContain(BEGIN_SYNC);
        expect(written[4]).toBe(END_SYNC);
    });

    it("paints only what changed again once it has put the picture back", async () => {
        const { stdout, written } = fakeStdout();
        painter = new DirectPainter(stdout);
        painter.paint(picture());
        stdout.write("[2Kink redraws the screen");
        await Promise.resolve();
        const count = written.length;

        painter.paint(picture());

        expect(written).toHaveLength(count);
    });

    it("does not take its own writes for someone else's", () => {
        const { stdout, written } = fakeStdout();
        painter = new DirectPainter(stdout);

        painter.paint(picture());
        painter.paint(picture());
        painter.paint(picture());

        expect(written).toHaveLength(1);
    });

    it("stops watching the stream once disposed", () => {
        const { stdout } = fakeStdout();
        const original = stdout.write;
        painter = new DirectPainter(stdout);
        expect(stdout.write).not.toBe(original);

        painter.dispose();

        expect(stdout.write).toBe(original);
    });
});
