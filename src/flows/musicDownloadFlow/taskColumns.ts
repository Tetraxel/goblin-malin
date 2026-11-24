import { providerDisplayRegistry } from "#base/providerDisplay";
import { type ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { UrlCell } from "./columns/UrlCell";
import { ArtistCell } from "./columns/ArtistCell";
import { TrackCell } from "./columns/TrackCell";
import { StatusCell } from "./columns/StatusCell";
import { ToTagCell } from "./columns/ToTagCell";
import { ToDownloadCell } from "./columns/ToDownloadCell";
import { stemCellFor } from "./columns/StemCell";
import { stemKindRegistry, stemSetKinds } from "./stems/stemKinds";
import { getStemSettings } from "./stems/stemProviders";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "./registries";
import { getMusicSettings, saveMusicSettings } from "./settings";
import { type MusicDownloadTaskAttributes } from "./types";

export type { PrimaryMode } from "#types/focus";
import { type PrimaryMode } from "#types/focus";

type Column = ColumnDefinition<MusicDownloadTaskAttributes>;

const GenericProviderCell: Column["component"] = () => null;

/** The weight of one platform column, while there are few of them. */
const PLATFORM_WEIGHT = 20;
/** Up to this many platform columns, each weighs `PLATFORM_WEIGHT`. */
const FEW_PLATFORMS = 3;
/** A platform column never weighs less than this (its acronym still fits: `minWidth`). */
const MIN_PLATFORM_WEIGHT = 4;

/**
 * Pure derivation: (display mode, current settings) → column list. Callers
 * recompute via useMemo keyed on the mode and a settings version — there is no
 * subscription or cached state here.
 */
export function computeColumns(mode: PrimaryMode): Column[] {
    const settings = getMusicSettings();

    const checkboxColumns: Column[] = [
        { id: "toTag", label: "TAG?", weight: 0, flexGrow: 0, resizable: false, component: ToTagCell },
        { id: "toDownload", label: "DL?", weight: 0, flexGrow: 0, resizable: false, component: ToDownloadCell },
    ];
    const trackColumns: Column[] = [
        {
            id: "url",
            label: "URL",
            weight: mode === "metadata" ? 45 : 3,
            flexGrow: 0,
            component: UrlCell,
        },
        { id: "artist", label: "ARTIST", weight: 16, flexGrow: 0, component: ArtistCell },
        { id: "track", label: "TRACK", weight: 30, flexGrow: 0, component: TrackCell },
    ];
    const statusColumns: Column[] = [{ id: "status", label: "STATUS", weight: 28, flexGrow: 0, component: StatusCell }];

    let columns: Column[] = [...checkboxColumns, ...trackColumns];

    if (mode === "metadata") {
        const { providers, discoveryProviders } = settings.metadata;
        const metadataKeys = Array.from(
            metadataServiceRegistry.getEnabledFactories((key) => providers[key]?.enabled !== false).keys()
        );
        // Past three platforms, each column weighs less, and all of them together too (every column also takes its
        // acronym's width first): more platforms must not squeeze the link and the title. A platform cell only shows
        // an id, which is still readable truncated.
        const crowding = Math.min(1, FEW_PLATFORMS / Math.max(1, metadataKeys.length));
        const metadataWeight = Math.max(MIN_PLATFORM_WEIGHT, PLATFORM_WEIGHT * crowding * crowding);
        const metadataServiceColumns: Column[] = metadataKeys.map((key) => {
            const display = providerDisplayRegistry.get(key);
            return {
                id: `metadataService-${key}`,
                label: display.label.toUpperCase(),
                acronym: display.acronym,
                minWidth: Math.max(2, display.acronym.length + 3),
                color: display.color,
                weight: metadataWeight,
                flexGrow: 0,
                component:
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (metadataServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
            };
        });
        const discoveryServiceColumns: Column[] = Array.from(
            discoveryServiceRegistry.getEnabledFactories((key) => discoveryProviders[key]?.enabled !== false).keys()
        ).map((key) => {
            const display = providerDisplayRegistry.get(key);
            return {
                id: `discoveryService-${key}`,
                label: display.label.toUpperCase(),
                acronym: display.acronym,
                minWidth: Math.max(2, display.acronym.length + 3),
                color: display.color,
                weight: 12,
                flexGrow: 0,
                component:
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (discoveryServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
            };
        });
        columns = columns.concat(metadataServiceColumns).concat(discoveryServiceColumns);
    }

    if (mode === "download") {
        const { providers } = settings.download;
        const downloadServiceColumns: Column[] = Array.from(
            downloadServiceRegistry.getEnabledFactories((key) => providers[key]?.enabled !== false).keys()
        ).map((key) => {
            const display = providerDisplayRegistry.get(key);
            return {
                id: `downloadService-${key}`,
                label: display.label.toUpperCase(),
                acronym: display.acronym,
                minWidth: Math.max(2, display.acronym.length + 3),
                color: display.color,
                weight: 32,
                flexGrow: 0,
                component:
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (downloadServiceRegistry.getConstructor(key) as any)?.cellComponent ?? GenericProviderCell,
            };
        });
        columns = columns.concat(downloadServiceColumns);
    }

    if (mode === "stems") {
        // One column per stem of the set chosen in Settings → Stems (4 by default). A run can make more stems: the
        // Stems tab below lists them all.
        const stemColumns: Column[] = stemSetKinds(getStemSettings().stemSet).map((kind) => {
            const display = stemKindRegistry.get(kind);
            return {
                id: `stem-${kind}`,
                label: display.label.toUpperCase(),
                acronym: display.acronym,
                minWidth: Math.max(2, display.acronym.length + 3),
                color: display.color,
                weight: 14,
                flexGrow: 0,
                component: stemCellFor(kind),
            };
        });
        columns = columns.concat(stemColumns);
    }

    const allColumns = [...columns, ...statusColumns];
    const storedRatios = settings.ui.columnRatios;
    return allColumns.map((col) =>
        storedRatios[col.id] !== undefined ? { ...col, widthRatio: storedRatios[col.id] } : col
    );
}

/** Persist user column resizes; the settings-change notification triggers recompute. */
export function saveColumnRatios(ratios: Record<string, number>): void {
    const current = getMusicSettings();
    saveMusicSettings({ ...current, ui: { ...current.ui, columnRatios: ratios } });
}
