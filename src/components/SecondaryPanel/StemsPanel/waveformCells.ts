/** Eight heights of a block, from silence to the loudest. */
const LEVELS = " ▁▂▃▄▅▆▇█";
/**
 * The bar of a waveform `width` cells wide: the loudest slice under each cell, as a block of that height. Anything
 * not silent is at least the lowest block, so quiet passages still read as sound.
 */
export function waveformCells(peaks: readonly number[], width: number): string {
    if (width <= 0) return "";
    let out = "";
    for (let c = 0; c < width; c++) {
        const from = Math.floor((c * peaks.length) / width);
        const to = Math.max(from + 1, Math.floor(((c + 1) * peaks.length) / width));
        let max = 0;
        for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
        const level = max <= 0.01 ? 0 : Math.max(1, Math.round(max * 8));
        out += LEVELS[level];
    }
    return out;
}
