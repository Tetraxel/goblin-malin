import { providerDisplayRegistry } from "#base/providerDisplay";
import { Canvas, RGB, hex } from "./canvas";
import { toRGB } from "./ui";

// Shared pieces of the app tour: layout, demo data, palette, and the scene signature.

export interface TourOptions {
    /** Live binding of the import shortcut, split into keycaps (e.g. ["Ctrl", "V"]). */
    importKeys: string[];
    /** Live binding that closes the intro (e.g. "Esc"). */
    closeKey: string;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface TourLayout {
    /** Where the mascot sits as the guide, in pixels. */
    mascot: { cx: number; cy: number; r: number };
    captionX: number;
    headerH: number;
    table: Rect;
    detail: Rect;
}

export function tourLayout(cols: number, rows: number): TourLayout {
    // A taller header keeps the guide mascot big enough to read at terminal resolution.
    const headerH = Math.max(7, Math.min(12, Math.round(rows * 0.24)));
    const r = headerH - 0.5;
    const mascot = { cx: 3 + r, cy: headerH, r };
    const table: Rect = { x: 2, y: headerH, w: cols - 4, h: 6 };
    const detailY = table.y + table.h + 1;
    return {
        mascot,
        captionX: Math.round(mascot.cx + r + 4),
        headerH,
        table,
        detail: { x: 2, y: detailY, w: cols - 4, h: Math.max(4, rows - detailY - 1) },
    };
}

/** Scene-local time `s` starts at 0 when the step begins. */
export type SceneDraw = (canvas: Canvas, s: number, l: TourLayout, o: TourOptions) => void;

// A made-up track.
export const DEMO = {
    spotifyUrl: "https://open.spotify.com/track/6gHq2ZkPj1sVxT0aLmN9cR",
    youtubeUrl: "https://youtube.com/watch?v=Jk3wQ9mX2pE",
    youtubeShort: "youtu.be/Jk3wQ9mX2pE",
    artist: "Nova Drift",
    title: "Midnight Arcade",
    album: "Neon Tides",
    year: "2024",
    genre: "Synthwave",
    isrc: "QZES82412345",
    length: "3:41",
    fileName: "Nova Drift - Midnight Arcade.m4a",
    sizeMiB: 8.6,
    folders: ["~/Music", "Nova Drift", "Neon Tides"],
};

export const C = {
    text: hex("#E6E8F5"),
    muted: hex("#7A7F9A"),
    dim: hex("#4A4E66"),
    border: hex("#3FC1D6"),
    panel: hex("#07080F"),
    rowHi: hex("#1A1D2E"),
    focus: hex("#262A45"),
    success: hex("#3DDC84"),
    error: hex("#FF4D5E"),
    accent: hex("#FFCC1F"),
};

export const provider = (key: string): { label: string; acronym: string; color: RGB; bright: RGB } => {
    const d = providerDisplayRegistry.get(key);
    return { label: d.label, acronym: d.acronym, color: toRGB(d.color), bright: toRGB(d.colorBright) };
};
