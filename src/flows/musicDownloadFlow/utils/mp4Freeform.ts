import * as fs from "fs";

/**
 * A tiny MP4 tag writer for what ffmpeg cannot write in the form other software reads.
 *
 * ffmpeg writes the standard iTunes atoms (`©nam`, `©ART`, `©alb`…) for the usual tags and drops the others. The
 * switch that keeps them (`-movflags use_metadata_tags`) writes every tag in the `mdta` key/value form, which
 * Picard, beets, iTunes and most players do not read at all. So ffmpeg writes the standard ones, and this adds the
 * rest as the atoms those programs look for: iTunes "freeform" items (`----:com.apple.iTunes:<name>`) and `tmpo`.
 */

export type Mp4Item = { name: string; value: string };

const FREEFORM_NAMESPACE = "com.apple.iTunes";

type Atom = { type: string; start: number; end: number; headerSize: number };

/** The atoms between `start` and `end`, or `null` when the sizes make no sense (a file that is not well formed). */
function readAtoms(buf: Buffer, start: number, end: number): Atom[] | null {
    const atoms: Atom[] = [];
    let at = start;
    while (at + 8 <= end) {
        let size = buf.readUInt32BE(at);
        const type = buf.toString("latin1", at + 4, at + 8);
        let headerSize = 8;
        if (size === 1) {
            if (at + 16 > end) return null;
            size = Number(buf.readBigUInt64BE(at + 8));
            headerSize = 16;
        } else if (size === 0) {
            size = end - at;
        }
        if (size < headerSize || at + size > end) return null;
        atoms.push({ type, start: at, end: at + size, headerSize });
        at += size;
    }
    return atoms;
}

const child = (buf: Buffer, parent: Atom, type: string, skip = 0): Atom | undefined => {
    const atoms = readAtoms(buf, parent.start + parent.headerSize + skip, parent.end);
    return atoms?.find((a) => a.type === type);
};

/** One atom: size, type, then the parts. */
const atom = (type: string, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, body]);
};

/** A `data` atom: a type code (1 = UTF-8 text, 21 = integer) and a locale, then the value. */
const dataAtom = (typeCode: number, value: Buffer): Buffer => {
    const flags = Buffer.alloc(8);
    flags.writeUInt32BE(typeCode, 0);
    return atom("data", flags, value);
};

const versionAndFlags = Buffer.alloc(4);

/** `----:com.apple.iTunes:<name>`, the form Picard, beets and mutagen use for tags with no atom of their own. */
const freeformItem = ({ name, value }: Mp4Item): Buffer =>
    atom(
        "----",
        atom("mean", versionAndFlags, Buffer.from(FREEFORM_NAMESPACE, "utf8")),
        atom("name", versionAndFlags, Buffer.from(name, "utf8")),
        dataAtom(1, Buffer.from(value, "utf8"))
    );

/** `tmpo`: the tempo as a 16-bit integer, where players look for it. */
const tempoItem = (bpm: number): Buffer => {
    const value = Buffer.alloc(2);
    value.writeUInt16BE(Math.max(0, Math.min(0xffff, Math.round(bpm))));
    return atom("tmpo", dataAtom(21, value));
};

/** Adds `delta` to every sample-table offset that points at or after `insertAt` (when `moov` comes before `mdat`). */
function shiftChunkOffsets(buf: Buffer, moov: Atom, insertAt: number, delta: number): boolean {
    const walk = (parent: Atom, path: string[]): boolean => {
        const [next, ...rest] = path;
        const atoms = readAtoms(buf, parent.start + parent.headerSize, parent.end);
        if (!atoms) return false;
        for (const a of atoms.filter((x) => x.type === next)) {
            if (rest.length > 0) {
                if (!walk(a, rest)) return false;
                continue;
            }
            // `stco` / `co64`: version + flags, a count, then the offsets.
            const body = a.start + a.headerSize;
            const count = buf.readUInt32BE(body + 4);
            const wide = a.type === "co64";
            const width = wide ? 8 : 4;
            if (body + 8 + count * width > a.end) return false;
            for (let i = 0; i < count; i++) {
                const at = body + 8 + i * width;
                if (wide) {
                    const offset = buf.readBigUInt64BE(at);
                    if (offset >= BigInt(insertAt)) buf.writeBigUInt64BE(offset + BigInt(delta), at);
                } else {
                    const offset = buf.readUInt32BE(at);
                    if (offset >= insertAt) {
                        if (offset + delta > 0xffffffff) return false;
                        buf.writeUInt32BE(offset + delta, at);
                    }
                }
            }
        }
        return true;
    };
    return walk(moov, ["trak", "mdia", "minf", "stbl", "stco"]) && walk(moov, ["trak", "mdia", "minf", "stbl", "co64"]);
}

/**
 * Appends items to the `ilst` of an MP4 / M4A file (rewriting the file through a temporary copy beside it).
 * Resolves false, with the file untouched, when its layout is not one this handles (no `ilst`, 64-bit atom sizes
 * on the path): the caller then has the standard tags only.
 */
export async function addMp4Items(filePath: string, items: readonly Mp4Item[], bpm?: number): Promise<boolean> {
    const added = [...items.map(freeformItem), ...(bpm != null && Number.isFinite(bpm) ? [tempoItem(bpm)] : [])];
    if (added.length === 0) return true;
    const insert = Buffer.concat(added);

    const buf = await fs.promises.readFile(filePath);
    const top = readAtoms(buf, 0, buf.length);
    const moov = top?.find((a) => a.type === "moov");
    if (!moov) return false;
    const udta = child(buf, moov, "udta");
    // `meta` is a full box: four bytes of version and flags come before its children (hence the 4).
    const meta = udta && child(buf, udta, "meta");
    const ilst = meta && child(buf, meta, "ilst", 4);
    if (!udta || !meta || !ilst) return false;

    // Sizes of the atoms that contain the new items; a 64-bit size is not worth handling here.
    const parents = [moov, udta, meta, ilst];
    if (parents.some((p) => p.headerSize !== 8)) return false;
    const insertAt = ilst.end;
    // The offsets first: they are found by reading the atoms' sizes as they are now.
    if (!shiftChunkOffsets(buf, moov, insertAt, insert.length)) return false;
    for (const p of parents) buf.writeUInt32BE(p.end - p.start + insert.length, p.start);

    const rewritten = `${filePath}.items`;
    try {
        await fs.promises.writeFile(
            rewritten,
            Buffer.concat([buf.subarray(0, insertAt), insert, buf.subarray(insertAt)])
        );
        await fs.promises.rename(rewritten, filePath);
    } catch (error) {
        await fs.promises.rm(rewritten, { force: true });
        throw error;
    }
    return true;
}
