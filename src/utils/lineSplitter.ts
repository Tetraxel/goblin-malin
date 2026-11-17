import { StringDecoder } from "string_decoder";

/**
 * Turns the chunks a child process writes into whole lines. A chunk can end in the middle of a line or of a
 * multi-byte character, and Windows ends lines with `\r\n`: the decoder keeps a split character together, the
 * unfinished line is held back until its end arrives, and the `\r` is dropped. Blank lines are skipped.
 * `end()` hands over what is left when the stream closes.
 */
export function createLineSplitter(onLine: (line: string) => void): {
    write: (chunk: Buffer | string) => void;
    end: () => void;
} {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const emit = (line: string) => {
        const clean = line.replace(/\r$/, "");
        if (clean.trim()) onLine(clean);
    };
    return {
        write(chunk) {
            pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            lines.forEach(emit);
        },
        end() {
            pending += decoder.end();
            if (pending) emit(pending);
            pending = "";
        },
    };
}
