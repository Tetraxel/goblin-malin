import type { Scenario } from "./types.ts";

/**
 * Reads a scenario file: JSON in which a `//` comment runs to the end of the line, as in the examples of the README
 * (a `//` inside a string, such as a URL, is text and stays). Plain JSON is read the same way.
 */
export function parseScenario(raw: string): Scenario {
    let out = "";
    let inString = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            out += ch;
            if (ch === "\\") out += raw[++i] ?? "";
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
            out += ch;
        } else if (ch === "/" && raw[i + 1] === "/") {
            while (i < raw.length && raw[i] !== "\n") i++;
            out += "\n";
        } else {
            out += ch;
        }
    }
    return JSON.parse(out.replace(/^\uFEFF/, "")) as Scenario;
}
