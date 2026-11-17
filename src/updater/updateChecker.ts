import { APP_VERSION } from "#constants";

export interface UpdateInfo {
    hasUpdate: boolean;
    latestVersion: string;
    releaseUrl: string;
}

type Version = { core: [number, number, number]; pre: string[] };

/** `1.2.3-beta.1+build` → numbers and pre-release identifiers; `null` when it is not a version. */
function parseVersion(text: string): Version | null {
    const [withoutBuild] = text.trim().replace(/^v/, "").split("+");
    const dash = withoutBuild.indexOf("-");
    const coreText = dash < 0 ? withoutBuild : withoutBuild.slice(0, dash);
    const parts = coreText.split(".");
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    const [major = 0, minor = 0, patch = 0] = parts.map(Number);
    return { core: [major, minor, patch], pre: dash < 0 ? [] : withoutBuild.slice(dash + 1).split(".") };
}

/** Semver order of two pre-release lists: a number is below a word, and a shorter list below a longer one it starts. */
function comparePre(a: string[], b: string[]): number {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const [x, y] = [a[i], b[i]];
        if (x === y) continue;
        const [xNum, yNum] = [/^\d+$/.test(x), /^\d+$/.test(y)];
        if (xNum && yNum) return Number(x) - Number(y);
        if (xNum !== yNum) return xNum ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return a.length - b.length;
}

/** Whether `remote` is a later version than `local`. A tag that is not a version never is; a release is later than its pre-releases. */
export function isNewer(local: string, remote: string): boolean {
    const l = parseVersion(local);
    const r = parseVersion(remote);
    if (!l || !r) return false;
    for (let i = 0; i < 3; i++) {
        if (r.core[i] !== l.core[i]) return r.core[i] > l.core[i];
    }
    if (l.pre.length === 0) return false;
    if (r.pre.length === 0) return true;
    return comparePre(r.pre, l.pre) > 0;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
    try {
        const res = await fetch("https://api.github.com/repos/Tetraxel/goblin-malin/releases/latest", {
            headers: { "User-Agent": "goblin-malin-updater" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { tag_name: string; html_url: string };
        return {
            hasUpdate: isNewer(APP_VERSION, data.tag_name),
            latestVersion: data.tag_name.replace(/^v/, ""),
            releaseUrl: data.html_url,
        };
    } catch {
        return null;
    }
}
