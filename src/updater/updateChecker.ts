import { APP_VERSION } from "#constants";

export interface UpdateInfo {
    hasUpdate: boolean;
    latestVersion: string;
    releaseUrl: string;
}

function isNewer(local: string, remote: string): boolean {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
    const [lMaj = 0, lMin = 0, lPatch = 0] = parse(local);
    const [rMaj = 0, rMin = 0, rPatch = 0] = parse(remote);
    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPatch > lPatch;
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
