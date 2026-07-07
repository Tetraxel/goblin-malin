import { providerDisplayRegistry } from "#base/providerDisplay";
import { ColumnDefinition } from "#components/TaskListPanel/TaskListPanel";
import { UrlCell } from "./columns/UrlCell";
import { ArtistCell } from "./columns/ArtistCell";
import { TrackCell } from "./columns/TrackCell";
import { StatusCell } from "./columns/StatusCell";
import { ToTagCell } from "./columns/ToTagCell";
import { ToDownloadCell } from "./columns/ToDownloadCell";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "./registries";
import { getMusicSettings, saveMusicSettings } from "./settings";
import { MusicDownloadTaskAttributes } from "./types";

export type PrimaryMode = "metadata" | "download";

type Column = ColumnDefinition<MusicDownloadTaskAttributes>;

const GenericProviderCell: Column["component"] = () => null;

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
        const metadataServiceColumns: Column[] = Array.from(
            metadataServiceRegistry.getEnabledFactories((key) => providers[key]?.enabled !== false).keys()
        ).map((key) => {
            const display = providerDisplayRegistry.get(key);
            return {
                id: `metadataService-${key}`,
                label: display.label.toUpperCase(),
                acronym: display.acronym,
                minWidth: Math.max(2, display.acronym.length + 3),
                color: display.color,
                weight: 20,
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
