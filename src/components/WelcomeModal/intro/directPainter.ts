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
// A full repaint now and then heals anything else that wrote to the screen.
const FULL_REPAINT_MS = 2000;

export class DirectPainter {
    private previous: Frame | null = null;
    private writing = false;
    private lastFullPaint = 0;

    constructor(private readonly stdout: NodeJS.WritableStream) {}

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
        const now = performance.now();
        if (now - this.lastFullPaint >= FULL_REPAINT_MS) this.invalidate();
        if (!this.previous) this.lastFullPaint = now;

        const { ansi, frame } = canvas.diffFrom(this.previous);
        this.previous = frame;
        if (!ansi) return;

        this.writing = true;
        this.stdout.write(SYNC_START + SAVE_CURSOR + ansi + RESTORE_CURSOR + SYNC_END, () => {
            this.writing = false;
        });
    }
}
