import { describe, expect, it } from "vitest";
import { filterSettingsItems, type SettingsItem } from "#settings/buildSettingsItems";

const checkbox = (label: string): SettingsItem => ({
    kind: "checkbox",
    label,
    indent: 2,
    get: () => false,
    set: () => {},
});
const note = (text: string): SettingsItem => ({ kind: "note", indent: 2, text });

describe("filterSettingsItems", () => {
    const items: SettingsItem[] = [
        { kind: "sectionHeader", label: "Download" },
        checkbox("Convert every download"),
        note("A lossy source keeps its quality."),
        { kind: "providerHeader", label: "YtDlp", color: "red" },
        note("Uses links from: YouTube, SoundCloud"),
        checkbox("Enable"),
        checkbox("Auto-download latest binaries"),
        { kind: "providerHeader", label: "Soulseek", color: "blue" },
        note("Uses links from: any platform"),
        checkbox("Enable"),
    ];
    const texts = (list: SettingsItem[]) => list.map((i) => ("text" in i ? i.text : i.label));

    it("keeps the note under a provider header when a row below the header matches", () => {
        const result = filterSettingsItems(items, "auto-download");
        expect(texts(result)).toEqual([
            "Download",
            "YtDlp",
            "Uses links from: YouTube, SoundCloud",
            "Auto-download latest binaries",
        ]);
    });

    it("keeps each provider's own note when the section matches", () => {
        const result = filterSettingsItems(items, "download");
        expect(texts(result)).toContain("Uses links from: YouTube, SoundCloud");
        expect(texts(result)).toContain("Uses links from: any platform");
    });

    it("still keeps a note with the row above it", () => {
        expect(texts(filterSettingsItems(items, "convert every"))).toEqual([
            "Download",
            "Convert every download",
            "A lossy source keeps its quality.",
        ]);
    });

    it("drops the note of a provider with no matching row", () => {
        expect(texts(filterSettingsItems(items, "auto-download"))).not.toContain("Uses links from: any platform");
    });
});
