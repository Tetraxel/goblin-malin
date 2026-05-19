import { MetadataSourceState, StandardArtist } from "../types";
import { CompiledMetadata, CompiledMetadataField } from "./compiledMetadata";

export type FieldDef = {
    key: CompiledMetadataField;
    label: string;
    getSourceValue: (s: MetadataSourceState) => string;
    getCompiledValue: (c: CompiledMetadata) => string;
    editable: boolean;
    parseValue?: (input: string) => unknown;
};

function formatDuration(ms: number | undefined): string {
    if (!ms) return "—";
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export const FIELDS: FieldDef[] = [
    {
        key: "trackName",
        label: "Title",
        getSourceValue: (s) => s.metadata.trackName || "—",
        getCompiledValue: (c) => c.trackName || "—",
        editable: true,
    },
    {
        key: "artists",
        label: "Artists",
        getSourceValue: (s) => s.metadata.artists.map((a) => a.name).join(", ") || "—",
        getCompiledValue: (c) => c.artists.map((a) => a.name).join(", ") || "—",
        editable: true,
        parseValue: (input: string): StandardArtist[] =>
            input
                .split(",")
                .map((n) => ({ type: "artist" as const, name: n.trim() }))
                .filter((a) => a.name),
    },
    {
        key: "duration",
        label: "Duration",
        getSourceValue: (s) => formatDuration(s.metadata.duration),
        getCompiledValue: (c) => formatDuration(c.duration),
        editable: true,
        parseValue: (input: string) => {
            const match = input.trim().match(/^(\d+):(\d{1,2})$/);
            if (!match) return null;
            const minutes = parseInt(match[1]!);
            const seconds = parseInt(match[2]!);
            if (seconds >= 60) return null;
            return (minutes * 60 + seconds) * 1000;
        },
    },
    {
        key: "isrc",
        label: "ISRC",
        getSourceValue: (s) => s.metadata.isrc ?? "—",
        getCompiledValue: (c) => c.isrc ?? "—",
        editable: true,
    },
    {
        key: "album",
        label: "Album",
        getSourceValue: (s) => s.metadata.album?.albumName ?? "—",
        getCompiledValue: (c) => c.album?.albumName ?? "—",
        editable: false,
    },
    {
        key: "year",
        label: "Year",
        getSourceValue: (s) => {
            const date = s.metadata.album?.releaseDate;
            if (!date) return "—";
            return date.split("-")[0] ?? "—";
        },
        getCompiledValue: (c) => c.year?.toString() ?? "—",
        editable: true,
        parseValue: (input: string) => {
            const t = input.trim();
            if (!/^\d+$/.test(t)) return null;
            return parseInt(t, 10);
        },
    },
    {
        key: "trackNumber",
        label: "Track #",
        getSourceValue: (s) => s.metadata.trackNumber?.toString() ?? "—",
        getCompiledValue: (c) => c.trackNumber?.toString() ?? "—",
        editable: true,
        parseValue: (input: string) => {
            const t = input.trim();
            if (!/^\d+$/.test(t)) return null;
            return parseInt(t, 10);
        },
    },
    {
        key: "bpm",
        label: "BPM",
        getSourceValue: (s) => s.metadata.bpm?.toString() ?? "—",
        getCompiledValue: (c) => c.bpm?.toString() ?? "—",
        editable: true,
        parseValue: (input: string) => {
            const t = input.trim();
            if (!/^\d+$/.test(t)) return null;
            return parseInt(t, 10);
        },
    },
    {
        key: "key",
        label: "Key",
        getSourceValue: (s) => s.metadata.key ?? "—",
        getCompiledValue: (c) => c.key ?? "—",
        editable: true,
    },
    {
        key: "genres",
        label: "Genres",
        getSourceValue: (s) => s.metadata.genres?.join(", ") ?? "—",
        getCompiledValue: (c) => c.genres?.join(", ") ?? "—",
        editable: true,
        parseValue: (input: string): string[] =>
            input
                .split(",")
                .map((g) => g.trim())
                .filter(Boolean),
    },
];

export const navigableFields = FIELDS.filter((f) => f.editable);
