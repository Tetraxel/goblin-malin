export function darken(hex: string, factor: number): string {
    const scale = Math.max(0, Math.min(1, factor));
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * scale);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * scale);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * scale);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Blend toward white: factor 0 = original, factor 1 = white
export function lighten(hex: string, factor: number): string {
    const scale = Math.max(0, Math.min(1, factor));
    const r = Math.round(parseInt(hex.slice(1, 3), 16) + (255 - parseInt(hex.slice(1, 3), 16)) * scale);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) + (255 - parseInt(hex.slice(3, 5), 16)) * scale);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) + (255 - parseInt(hex.slice(5, 7), 16)) * scale);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function isLight(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}
