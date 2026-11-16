import * as fs from "fs/promises";
import * as path from "path";
import { DEFAULT_APP_DATA_DIR } from "../constants.js";
import { renameReplacing } from "#utils/dataFile";

/** What a value written as it is would not survive: the characters dotenv reads as syntax. */
const NEEDS_QUOTES = /[\s#"'`\\]/;
/** Single quotes and backticks first: dotenv reads their content as it is, while inside double quotes it turns a backslash followed by `n` or `r` into a line break. */
const QUOTES = ["'", "`", '"'] as const;
const ESCAPE_IN_DOUBLE_QUOTES = /\\[nr]/;

/**
 * `value` as the right-hand side of a `KEY=value` line, so that dotenv reads back exactly the text that was given. Plain
 * when it can be (`abc` stays `abc`); otherwise wrapped in the first quote character the value does not contain
 * (dotenv has no escape for a quote inside quotes, and does not trim quoted text).
 *
 * Throws for a value that cannot be stored faithfully: a line break or other control character (a pasted value with
 * one would also start a new variable), or one that holds every kind of quote that could wrap it.
 */
export function formatEnvValue(value: string): string {
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
    if (/[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error("A value with a line break or a control character cannot be saved to the .env file.");
    }
    if (!NEEDS_QUOTES.test(value) && value !== "") return value;
    const quote = QUOTES.find((q) => !value.includes(q) && (q !== '"' || !ESCAPE_IN_DOUBLE_QUOTES.test(value)));
    if (!quote) throw new Error("A value with a double quote, a single quote and a backtick cannot be saved to .env.");
    return `${quote}${value}${quote}`;
}

/** A line that sets `key` (whatever the case: the same variable written another way is replaced, not duplicated). */
function keyLine(key: string): RegExp {
    return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`, "i");
}

/** One edit of the file at a time: each is a read, a change and a write, so two at once would lose one of them. */
let editChain: Promise<unknown> = Promise.resolve();
function serialised<T>(edit: () => Promise<T>): Promise<T> {
    const run = editChain.then(edit);
    editChain = run.catch(() => undefined);
    return run;
}

/**
 * Writes `content` to the file without ever leaving it half-written (a crash in the middle of a plain write would lose
 * every stored credential), readable by the user alone (`0600`: it holds secrets, and the default lets every local
 * user read it). Windows ignores the mode.
 */
async function writeEnvFile(envPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const staging = `${envPath}.${process.pid}.tmp`;
    try {
        await fs.writeFile(staging, content, { encoding: "utf-8", mode: 0o600 });
        await renameReplacing(staging, envPath);
    } finally {
        await fs.rm(staging, { force: true });
    }
}

export function saveEnvVar(key: string, value: string): Promise<void> {
    return serialised(async () => {
        const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
        const envContent = await fs.readFile(envPath, "utf-8").catch(() => "");

        const lines = envContent.split("\n");
        const keyPattern = keyLine(key);
        const existingIndex = lines.findIndex((line) => keyPattern.test(line.trim()));

        let updatedContent: string;
        if (existingIndex !== -1) {
            lines[existingIndex] = `${key}=${formatEnvValue(value)}`;
            updatedContent = lines.join("\n");
        } else {
            const line = `${key}=${formatEnvValue(value)}`;
            updatedContent = envContent.trim() ? `${envContent.trim()}\n${line}\n` : `${line}\n`;
        }

        await writeEnvFile(envPath, updatedContent);
    });
}

export function removeEnvVar(key: string): Promise<void> {
    return serialised(async () => {
        const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
        const content = await fs.readFile(envPath, "utf-8").catch(() => "");
        const keyPattern = keyLine(key);
        const lines = content.split("\n").filter((l) => !keyPattern.test(l.trim()));
        await writeEnvFile(envPath, collapseBlankLines(lines).join("\n"));
    });
}

/**
 * Remove all listed keys from .env and, if a group is provided, also remove
 * the section header comment when none of the group's vars remain.
 */
export function removeEnvVars(keys: string[], group?: { name: string; url?: string }): Promise<void> {
    return serialised(async () => {
        const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
        const content = await fs.readFile(envPath, "utf-8").catch(() => "");
        let lines = content.split("\n");

        for (const key of keys) {
            const pattern = keyLine(key);
            lines = lines.filter((l) => !pattern.test(l.trim()));
        }

        if (group) {
            const groupPrefix = `# ${group.name}`.toLowerCase();
            const headerIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith(groupPrefix));
            if (headerIdx !== -1) {
                // Check whether any variable lines remain after the header
                let hasVars = false;
                for (let i = headerIdx + 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line === "" || line.startsWith("#")) break;
                    if (line.includes("=")) {
                        hasVars = true;
                        break;
                    }
                }
                if (!hasVars) lines.splice(headerIdx, 1);
            }
        }

        await writeEnvFile(envPath, collapseBlankLines(lines).join("\n"));
    });
}

function collapseBlankLines(lines: string[]): string[] {
    const out: string[] = [];
    let prevBlank = false;
    for (const line of lines) {
        const blank = line.trim() === "";
        if (blank && prevBlank) continue;
        out.push(line);
        prevBlank = blank;
    }
    return out;
}

/**
 * Save multiple env vars grouped under a labelled section comment in .env.
 * Each var is removed from its current location (wherever it is) and
 * re-inserted into the group section, guaranteeing all vars end up together.
 */
export function saveEnvVarsGroup(vars: Record<string, string>, group: { name: string; url?: string }): Promise<void> {
    return serialised(async () => {
        const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
        const content = await fs.readFile(envPath, "utf-8").catch(() => "");
        let lines = content.split("\n");

        const commentHeader = group.url ? `# ${group.name} - ${group.url}` : `# ${group.name}`;

        const entries = Object.entries(vars).filter(([, v]) => v.trim());
        if (entries.length === 0) return;

        // Remove every key from its current location (so we can re-insert into the group)
        for (const [key] of entries) {
            const pattern = keyLine(key);
            lines = lines.filter((l) => !pattern.test(l.trim()));
        }

        // Find the group section header
        const groupPrefix = `# ${group.name}`.toLowerCase();
        const commentIdx = lines.findIndex(
            (l) => l.trim() === commentHeader || l.trim().toLowerCase().startsWith(groupPrefix)
        );

        const newLines = entries.map(([k, v]) => `${k}=${formatEnvValue(v)}`);

        if (commentIdx !== -1) {
            // Insert right after any remaining vars already in the group section
            let insertIdx = commentIdx + 1;
            while (insertIdx < lines.length) {
                const line = lines[insertIdx].trim();
                if (line.startsWith("#")) break;
                if (line === "") break;
                insertIdx++;
            }
            lines.splice(insertIdx, 0, ...newLines);
        } else {
            // Append a brand-new group section at the end
            while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
            lines.push("", commentHeader, ...newLines, "");
        }

        await writeEnvFile(envPath, lines.join("\n"));
    });
}
