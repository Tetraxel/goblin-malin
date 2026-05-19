import { useState, useCallback } from "react";
import { PendingImport } from "./ImportModal";
import { FlowBase } from "../../base/flow/flow-base";
import { useFocusContext } from "../../contexts/FocusContext";
import { globalLogger } from "../../base/logger/logger";
import { readClipboard } from "./clipboard";
import { detectUrls } from "./detectUrls";

export function useImportFlow(currentFlow: FlowBase | undefined) {
    const { focusState } = useFocusContext();
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

    const openImportFlow = useCallback(
        (text?: string) => {
            if (focusState.activeWindow === "prompt") return;

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
        [focusState.activeWindow]
    );

    const handleImportConfirm = useCallback(
        ({ fetchMetadata, download }: { fetchMetadata: boolean; download: boolean }) => {
            if (!pendingImport || !currentFlow) {
                setPendingImport(null);
                return;
            }
            const urls = pendingImport.urls.map((d) => d.raw);
            const tasks = currentFlow.createTasksFromUrls(urls, { toTag: fetchMetadata, toDownload: download });
            currentFlow.importTasks(tasks);
            setPendingImport(null);
        },
        [pendingImport, currentFlow]
    );

    const handleImportCancel = useCallback(() => {
        setPendingImport(null);
    }, []);

    return { pendingImport, setPendingImport, openImportFlow, handleImportConfirm, handleImportCancel };
}
