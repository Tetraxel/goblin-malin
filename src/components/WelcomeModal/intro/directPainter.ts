import { type Canvas, type Frame } from "./canvas";

// Paints intro frames straight to the terminal, bypassing Ink. Going through Ink costs
// ~30ms per frame (it re-parses every row character by character, re-renders the whole
// app and rewrites the whole screen), which alone uses up the frame budget. Here, React
// stays idle: only changed cells are written, and Ink, whose output doesn't change while
// the intro plays, writes nothing.

const SYNC_START = "\x1b[?2026h"; // hold the terminal's repaint until the frame is complete
const SYNC_END = "\x1b[?2026l";
const SAVE_CURSOR = "\x1b7"; // Ink tracks the cursor relatively: leave it where it was
const RESTORE_CURSOR = "\x1b8";
// A full repaint now and then heals anything that wrote to the screen without going through `stdout.write`.
const FULL_REPAINT_MS = 2000;

export class DirectPainter {
    private previous: Frame | null = null;
    private lastCanvas: Canvas | null = null;
    private writing = false;
    private lastFullPaint = 0;
    private ownWrite = false;
    private disposed = false;
    private insideInkFrame = false;
    private readonly originalWrite: NodeJS.WritableStream["write"];
    private readonly watchedWrite: NodeJS.WritableStream["write"];

    /**
     * Ink keeps writing to the same stream (any state change that alters its output, even under the intro's
     * backdrop, makes it erase and rewrite the whole screen). Every cell it wipes is a cell this painter still
     * believes is on screen, and would never redraw: black holes in the picture. So the stream is watched
     * while the painter lives, and a write that isn't ours forgets the picture and puts it back at once:
     *  - Ink wraps each frame in synchronized output (`?2026h` … `?2026l`): the picture is repainted just
     *    before the closing marker, so the terminal never shows the wiped frame at all;
     *  - any other write is followed by a repaint at the end of the current tick, not at the next frame.
     * Call `dispose()` when done.
     */
    constructor(private readonly stdout: NodeJS.WritableStream) {
        this.originalWrite = stdout.write;
        this.watchedWrite = ((...args: Parameters<NodeJS.WritableStream["write"]>) => {
            if (!this.ownWrite) this.onForeignWrite(args[0]);
            return this.originalWrite.apply(stdout, args);
        }) as NodeJS.WritableStream["write"];
        stdout.write = this.watchedWrite;
    }

    private onForeignWrite(chunk: unknown): void {
        this.invalidate();
        if (chunk === SYNC_START) {
            this.insideInkFrame = true;
        } else if (chunk === SYNC_END) {
            this.insideInkFrame = false;
            // Still inside the terminal's synchronized block: what it shows next is this repaint, in one piece.
            this.repaint(false);
        } else if (!this.insideInkFrame) {
            queueMicrotask(() => {
                if (!this.insideInkFrame && !this.previous) this.repaint(true);
            });
        }
    }

    /** Draws the last frame again, whole. */
    private repaint(sync: boolean): void {
        if (this.disposed || !this.lastCanvas) return;
        this.lastFullPaint = performance.now();
        this.flush(this.lastCanvas, sync);
    }

    /** Stops watching the stream. */
    dispose(): void {
        this.disposed = true;
        if (this.stdout.write === this.watchedWrite) this.stdout.write = this.originalWrite;
    }

    /** Forget what's on screen, so the next frame repaints everything. */
    invalidate(): void {
        this.previous = null;
    }

    /**
     * Whether the terminal has taken the last frame. While it hasn't, callers skip the
     * frame instead of queueing it: timing comes from the clock, so the animation stays
     * on time on a slow terminal, it just shows fewer frames.
     */
    get ready(): boolean {
        return !this.writing;
    }

    paint(canvas: Canvas): void {
        this.lastCanvas = canvas;
        const now = performance.now();
        if (now - this.lastFullPaint >= FULL_REPAINT_MS) this.invalidate();
        if (!this.previous) this.lastFullPaint = now;
        this.flush(canvas, true);
    }

    /** Writes what differs from the picture on screen. `sync` holds the terminal's repaint until it's all there. */
    private flush(canvas: Canvas, sync: boolean): void {
        const { ansi, frame } = canvas.diffFrom(this.previous);
        this.previous = frame;
        if (!ansi) return;

        this.writing = true;
        this.ownWrite = true;
        try {
            this.stdout.write(
                (sync ? SYNC_START : "") + SAVE_CURSOR + ansi + RESTORE_CURSOR + (sync ? SYNC_END : ""),
                () => {
                    this.writing = false;
                }
            );
        } finally {
            this.ownWrite = false;
        }
    }
}
