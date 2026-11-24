/** Standard xterm-256color palette: the colour a palette index is drawn in. */
export function palette256ToRgb(index: number): [number, number, number] {
    if (index < 16) {
        const SYSTEM: [number, number, number][] = [
            [0, 0, 0],
            [128, 0, 0],
            [0, 128, 0],
            [128, 128, 0],
            [0, 0, 128],
            [128, 0, 128],
            [0, 128, 128],
            [192, 192, 192],
            [128, 128, 128],
            [255, 0, 0],
            [0, 255, 0],
            [255, 255, 0],
            [0, 0, 255],
            [255, 0, 255],
            [0, 255, 255],
            [255, 255, 255],
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
