import * as fs from "fs";
import * as path from "path";
import { CompiledMetadata } from "./compiledMetadata";

export function computeOutputFilename(compiled: CompiledMetadata): string {
    const artist = compiled.artists[0]?.name ?? "Unknown Artist";
    const title = compiled.trackName || "Unknown Title";
    return `${artist} - ${title}.flac`.replace(/[/\\:*?"<>|]/g, "_");
}

export function computeOutputPath(compiled: CompiledMetadata, outputDir: string): string {
    const safe = computeOutputFilename(compiled);
    const basePath = path.join(outputDir, safe);

    let dest = basePath;
    let counter = 2;
    while (fs.existsSync(dest)) {
        const ext = path.extname(basePath);
        const base = path.basename(basePath, ext);
        dest = path.join(outputDir, `${base} (${counter})${ext}`);
        counter++;
    }
    return dest;
}
