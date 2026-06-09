import * as fs from "fs/promises";
import * as path from "path";
import { DEFAULT_APP_DATA_DIR } from "../constants.js";

export async function saveEnvVar(key: string, value: string): Promise<void> {
    const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
    const envContent = await fs.readFile(envPath, "utf-8").catch(() => "");

    const lines = envContent.split("\n");
    const keyPattern = new RegExp(`^${key}=`, "i");
    const existingIndex = lines.findIndex((line) => keyPattern.test(line.trim()));

    let updatedContent: string;
    if (existingIndex !== -1) {
        lines[existingIndex] = `${key}=${value}`;
        updatedContent = lines.join("\n");
    } else {
        updatedContent = envContent.trim() ? `${envContent.trim()}\n${key}=${value}\n` : `${key}=${value}\n`;
    }

    await fs.writeFile(envPath, updatedContent, "utf-8");
}

export async function removeEnvVar(key: string): Promise<void> {
    const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
    const content = await fs.readFile(envPath, "utf-8").catch(() => "");
    const keyPattern = new RegExp(`^${key}=`, "i");
    const lines = content.split("\n").filter((l) => !keyPattern.test(l.trim()));
    await fs.writeFile(envPath, collapseBlankLines(lines).join("\n"), "utf-8");
}

/**
 * Remove all listed keys from .env and, if a group is provided, also remove
 * the section header comment when none of the group's vars remain.
 */
export async function removeEnvVars(keys: string[], group?: { name: string; url?: string }): Promise<void> {
    const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
    const content = await fs.readFile(envPath, "utf-8").catch(() => "");
    let lines = content.split("\n");

    for (const key of keys) {
        const pattern = new RegExp(`^${key}=`, "i");
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

    await fs.writeFile(envPath, collapseBlankLines(lines).join("\n"), "utf-8");
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
export async function saveEnvVarsGroup(
    vars: Record<string, string>,
    group: { name: string; url?: string }
): Promise<void> {
    const envPath = path.join(DEFAULT_APP_DATA_DIR, ".env");
    const content = await fs.readFile(envPath, "utf-8").catch(() => "");
    let lines = content.split("\n");

    const commentHeader = group.url ? `# ${group.name} - ${group.url}` : `# ${group.name}`;

    const entries = Object.entries(vars).filter(([, v]) => v.trim());
    if (entries.length === 0) return;

    // Remove every key from its current location (so we can re-insert into the group)
    for (const [key] of entries) {
        const pattern = new RegExp(`^${key}=`, "i");
        lines = lines.filter((l) => !pattern.test(l.trim()));
    }

    // Find the group section header
    const groupPrefix = `# ${group.name}`.toLowerCase();
    const commentIdx = lines.findIndex(
        (l) => l.trim() === commentHeader || l.trim().toLowerCase().startsWith(groupPrefix)
    );

    const newLines = entries.map(([k, v]) => `${k}=${v}`);

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

    await fs.writeFile(envPath, lines.join("\n"), "utf-8");
}
