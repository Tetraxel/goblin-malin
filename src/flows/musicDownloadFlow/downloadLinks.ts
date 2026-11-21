import { providerDisplayRegistry } from "#base/providerDisplay";
import { metadataServiceRegistry } from "./registries";

/** What a download provider can download from, as the user is shown it. */
export type DownloadLinkInfo =
    /** It searches every track by its name: any platform's metadata will do. */
    | { kind: "any" }
    /** It downloads the track links of these platforms (the registered ones, in registry order). */
    | { kind: "platforms"; platforms: { key: string; label: string; color: string }[] }
    /** It declares nothing. */
    | { kind: "unknown" };

/** The platforms a download provider class (its `static linkPlatforms`) can download from. */
export function downloadLinkInfo(ctor: { linkPlatforms?: readonly string[] | "any" } | undefined): DownloadLinkInfo {
    const declared = ctor?.linkPlatforms;
    if (declared === "any") return { kind: "any" };
    if (!declared) return { kind: "unknown" };
    const keys = [...metadataServiceRegistry.getAllConstructors().keys()].filter((key) => declared.includes(key));
    // A platform it reads that has no metadata service yet is still worth naming.
    for (const key of declared) if (!keys.includes(key)) keys.push(key);
    return {
        kind: "platforms",
        platforms: keys.map((key) => {
            const display = providerDisplayRegistry.get(key);
            return { key, label: display.label || key, color: display.color };
        }),
    };
}

/** What a download provider takes, in a few words (the "any platform" / "not declared" / "none" cases). */
export function describeLinkSources(info: DownloadLinkInfo, isEnabled: (platformKey: string) => boolean): string {
    switch (info.kind) {
        case "any":
            return "any platform (it searches each track by artist and title)";
        case "unknown":
            return "not declared";
        case "platforms": {
            if (info.platforms.length === 0) return "none";
            return info.platforms.map((p) => (isEnabled(p.key) ? p.label : `${p.label} (off in Metadata)`)).join(", ");
        }
    }
}

/**
 * One line saying which links a download provider uses, and which of those platforms are switched off in Metadata
 * (`isEnabled`): a platform the user does not use is still where this provider finds its files.
 */
export function describeDownloadLinks(info: DownloadLinkInfo, isEnabled: (platformKey: string) => boolean): string {
    return `Uses links from: ${describeLinkSources(info, isEnabled)}`;
}
