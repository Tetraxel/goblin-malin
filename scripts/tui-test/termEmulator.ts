import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Terminal as ITerminal, ITerminalInitOnlyOptions, ITerminalOptions, IBufferCell } from "@xterm/headless";

const _require = createRequire(import.meta.url);

const { Terminal } = _require("@xterm/headless") as {
    Terminal: new (options?: ITerminalOptions & ITerminalInitOnlyOptions) => ITerminal;
};

// Standard xterm-256color 256-color palette
function palette256ToRgb(index: number): [number, number, number] {
    if (index < 16) {
        const SYSTEM: [number, number, number][] = [
            [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
            [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
            [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
            [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
        ];
        return SYSTEM[index] ?? [0, 0, 0];
    }
    if (index < 232) {
        const i = index - 16;
        const toV = (v: number) => (v === 0 ? 0 : 55 + v * 40);
        return [toV(Math.floor(i / 36)), toV(Math.floor(i / 6) % 6), toV(i % 6)];
    }
    const v = 8 + (index - 232) * 10;
    return [v, v, v];
}

function cellColorCss(cell: IBufferCell, role: "fg" | "bg"): string | null {
    const isDefault = role === "fg" ? cell.isFgDefault() : cell.isBgDefault();
    if (isDefault) return null;
    const isRGB = role === "fg" ? cell.isFgRGB() : cell.isBgRGB();
    const raw = role === "fg" ? cell.getFgColor() : cell.getBgColor();
    if (isRGB) return `rgb(${(raw >> 16) & 0xff},${(raw >> 8) & 0xff},${raw & 0xff})`;
    const [r, g, b] = palette256ToRgb(raw);
    return `rgb(${r},${g},${b})`;
}

function cellKey(cell: IBufferCell): string {
    const fg = cell.isFgDefault() ? "d" : cell.isFgRGB() ? `r${cell.getFgColor()}` : `p${cell.getFgColor()}`;
    const bg = cell.isBgDefault() ? "d" : cell.isBgRGB() ? `r${cell.getBgColor()}` : `p${cell.getBgColor()}`;
    return `${fg}.${bg}.${cell.isBold()}.${cell.isItalic()}.${cell.isDim()}.${cell.isUnderline()}.${cell.isStrikethrough()}.${cell.isInverse()}`;
}

function cellEscape(cell: IBufferCell): string {
    const p: string[] = ["0"];
    if (cell.isBold()) p.push("1");
    if (cell.isDim()) p.push("2");
    if (cell.isItalic()) p.push("3");
    if (cell.isUnderline()) p.push("4");
    if (cell.isInverse()) p.push("7");
    if (cell.isStrikethrough()) p.push("9");

    if (cell.isFgRGB()) {
        const fg = cell.getFgColor();
        p.push(`38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}`);
    } else if (cell.isFgPalette()) {
        p.push(`38;5;${cell.getFgColor()}`);
    }

    if (cell.isBgRGB()) {
        const bg = cell.getBgColor();
        p.push(`48;2;${(bg >> 16) & 0xff};${(bg >> 8) & 0xff};${bg & 0xff}`);
    } else if (cell.isBgPalette()) {
        p.push(`48;5;${cell.getBgColor()}`);
    }

    return `\x1b[${p.join(";")}m`;
}

const DEFAULT_BG = "#1e1e1e";
const DEFAULT_FG = "#c0c0c0";

export class TermEmulator {
    private terminal: ITerminal;
    private pendingWrites = 0;
    readonly cols: number;
    readonly rows: number;

    constructor(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
        this.terminal = new Terminal({ cols, rows, allowProposedApi: true });
    }

    feed(data: string): void {
        this.pendingWrites++;
        this.terminal.write(data, () => {
            this.pendingWrites--;
        });
    }

    async flush(): Promise<void> {
        const deadline = Date.now() + 2000;
        while (this.pendingWrites > 0 && Date.now() < deadline) {
            await new Promise<void>((r) => setTimeout(r, 5));
        }
    }

    readScreen(): string {
        const buffer = this.terminal.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < this.terminal.rows; i++) {
            const line = buffer.getLine(i);
            lines.push(line?.translateToString(true) ?? "");
        }
        while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
        return lines.join("\n");
    }

    readScreenAnsi(): string {
        const buffer = this.terminal.buffer.active;
        const lines: string[] = [];

        for (let row = 0; row < this.terminal.rows; row++) {
            const line = buffer.getLine(row);
            if (!line) { lines.push(""); continue; }

            type Seg = { key: string; escape: string; chars: string; bgDefault: boolean };
            const segs: Seg[] = [];

            for (let col = 0; col < this.terminal.cols; col++) {
                const cell = line.getCell(col);
                if (!cell || cell.getWidth() === 0) continue;

                const key = cellKey(cell);
                const last = segs.at(-1);
                if (last && last.key === key) {
                    last.chars += cell.getChars() || " ";
                } else {
                    segs.push({
                        key,
                        escape: cellEscape(cell),
                        chars: cell.getChars() || " ",
                        bgDefault: cell.isBgDefault(),
                    });
                }
            }

            // Trim trailing whitespace-only segments with default background
            while (segs.length > 0) {
                const s = segs[segs.length - 1]!;
                if (s.bgDefault && !s.chars.trim()) {
                    segs.pop();
                } else if (s.bgDefault) {
                    s.chars = s.chars.trimEnd();
                    if (!s.chars) segs.pop();
                    else break;
                } else {
                    break;
                }
            }

            lines.push(segs.length > 0 ? segs.map((s) => s.escape + s.chars).join("") + "\x1b[0m" : "");
        }

        while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        return lines.join("\n");
    }

    async renderToImage(outputPath: string): Promise<void> {
        const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");

        const fontSize = 13;

        // Primary: CascadiaMono (Windows Terminal's font — best terminal symbol coverage).
        // Falls back to DejaVu/Menlo on other platforms, then Consolas as last resort.
        const primaryCandidates: Array<[string, string | null]> = [
            ["C:\\Windows\\Fonts\\CascadiaMono.ttf", null],         // variable font, bold synthesized
            ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"],
            ["/System/Library/Fonts/Menlo.ttc", null],
            ["C:\\Windows\\Fonts\\consola.ttf", "C:\\Windows\\Fonts\\consolab.ttf"],
        ];
        let fontFamily = "monospace";
        for (const [regular, bold] of primaryCandidates) {
            try {
                GlobalFonts.registerFromPath(regular, "TermFont");
                fontFamily = "TermFont";
                if (bold) { try { GlobalFonts.registerFromPath(bold, "TermFont"); } catch {} }
                break;
            } catch {}
        }

        // Fallbacks for glyphs the primary font lacks (emoji, broad misc symbols)
        const fallbacks: Array<[string, string]> = [
            ["C:\\Windows\\Fonts\\seguisym.ttf", "TermSymbols"],   // misc symbols & arrows (U+26xx, U+2Bxx)
            ["C:\\Windows\\Fonts\\seguiemj.ttf", "TermEmoji"],     // emoji (😉 etc.)
            ["C:\\Windows\\Fonts\\msgothic.ttc", "TermGothic"],    // broad BMP coverage
            ["/usr/share/fonts/truetype/noto/NotoSansSymbols2.ttf", "TermSymbols"],
            ["/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", "TermEmoji"],
        ];
        const registeredFallbacks: string[] = [];
        for (const [fp, name] of fallbacks) {
            try {
                GlobalFonts.registerFromPath(fp, name);
                if (!registeredFallbacks.includes(name)) registeredFallbacks.push(name);
            } catch {}
        }
        const fontStack = [fontFamily, ...registeredFallbacks].join(", ");

        // Measure fixed cell dimensions using only the primary font
        const measureCanvas = createCanvas(200, 50);
        const mCtx = measureCanvas.getContext("2d");
        mCtx.font = `${fontSize}px ${fontFamily}`;
        const charWidth = Math.ceil(mCtx.measureText("M").width);
        const lineHeight = Math.ceil(fontSize * 1.4);

        const canvas = createCanvas(this.cols * charWidth, this.rows * lineHeight);
        const ctx = canvas.getContext("2d");

        // Fill default background
        ctx.fillStyle = DEFAULT_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const buffer = this.terminal.buffer.active;

        for (let row = 0; row < this.rows; row++) {
            const line = buffer.getLine(row);
            if (!line) continue;

            for (let col = 0; col < this.cols; col++) {
                const cell = line.getCell(col);
                if (!cell) continue;

                const cellW = cell.getWidth();
                if (cellW === 0) continue; // shadow cell of a wide char — already covered

                const x = col * charWidth;
                const y = row * lineHeight;
                // Wide chars (emoji, CJK) occupy 2 columns; fill the full pixel span
                const pixelWidth = cellW * charWidth;

                const inv = cell.isInverse();
                const rawFg = cellColorCss(cell, "fg");
                const rawBg = cellColorCss(cell, "bg");
                const displayedFg = inv ? (rawBg ?? DEFAULT_BG) : (rawFg ?? DEFAULT_FG);
                const displayedBg = inv ? (rawFg ?? DEFAULT_FG) : rawBg;

                if (displayedBg) {
                    ctx.fillStyle = displayedBg;
                    ctx.fillRect(x, y, pixelWidth, lineHeight);
                }

                const char = cell.getChars() || "";
                if (char && char !== " ") {
                    ctx.fillStyle = displayedFg;
                    ctx.font = `${cell.isBold() ? "bold " : ""}${fontSize}px ${fontStack}`;
                    // maxWidth clips the glyph to the cell span, preventing overflow into neighbours
                    ctx.fillText(char, x, y + fontSize, pixelWidth);
                }
            }
        }

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, canvas.toBuffer("image/png"));
    }
}
