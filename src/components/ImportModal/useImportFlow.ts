import { useState, useCallback } from "react";
import { PendingImport } from "./ImportModal";
import { useFocusChrome } from "#contexts/FocusContext";
import { globalLogger } from "#base/logger/logger";
import { readClipboard } from "./clipboard";
import { detectUrls } from "./detectUrls";
import { createTasksFromUrls, importTasks } from "#flows/musicDownloadFlow/taskFactory";

export function useImportFlow() {
    const { activeWindow } = useFocusChrome();
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

    const openImportFlow = useCallback(
        (text?: string) => {
            if (activeWindow === "prompt") return;

            const handle = (raw: string) => {
                const urls = detectUrls(raw);
                if (urls.length === 0) {
                    globalLogger.info("Import: no supported URLs found");
                    return;
                }
                setPendingImport((prev) => {
                    if (prev === null) {
                        return { urls, fetchMetadata: true, download: false };
                    }
                    const existingRaws = new Set(prev.urls.map((u) => u.raw));
                    const fresh = urls.filter((u) => !existingRaws.has(u.raw));
                    if (fresh.length === 0) return prev;
                    return { ...prev, urls: [...prev.urls, ...fresh] };
                });
            };

            if (text !== undefined) {
                handle(text);
                return;
            }

            readClipboard()
                .then(handle)
                .catch((err) => globalLogger.error("Clipboard read failed", { err }));
        },
        [activeWindow]
    );

    const handleImportConfirm = useCallback(
        ({ fetchMetadata, download }: { fetchMetadata: boolean; download: boolean }) => {
            if (!pendingImport) {
                setPendingImport(null);
                return;
            }
            const urls = pendingImport.urls.map((d) => d.raw);
            importTasks(createTasksFromUrls(urls, { toTag: fetchMetadata, toDownload: download }));
            setPendingImport(null);
        },
        [pendingImport]
    );

    const handleImportCancel = useCallback(() => {
        setPendingImport(null);
    }, []);

    return { pendingImport, setPendingImport, openImportFlow, handleImportConfirm, handleImportCancel };
}
