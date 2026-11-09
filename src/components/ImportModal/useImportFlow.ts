import { useState, useCallback } from "react";
import { PendingImport } from "./ImportModal";
import { useFocusChrome } from "#contexts/FocusContext";
import { globalLogger } from "#base/logger/logger";
import { readClipboard } from "./clipboard";
import { detectUrls } from "./detectUrls";
import { createTasksFromUrls, importTasks, MusicTask } from "#flows/musicDownloadFlow/taskFactory";
import { useTheme } from "#base/themeContext";
import { SessionManager } from "#sessions/sessionManager";
import { getArchivedTaskIds } from "#sessions/archive";
import { ConfirmModalConfig } from "#components/ConfirmModal/useConfirmModal";

export function useImportFlow(openConfirmModal: (config: ConfirmModalConfig) => void) {
    const theme = useTheme();
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

            const notify = (title: string, message: string) =>
                openConfirmModal({
                    title,
                    message,
                    choices: [{ label: "OK", color: theme.action.primary }],
                    accentColor: theme.status.warning,
                    onConfirm: () => {},
                });

            readClipboard().then(
                (raw) => {
                    if (raw.trim() === "") {
                        notify("Clipboard is empty", "Copy some music URLs first, then import again.");
                        return;
                    }
                    handle(raw);
                },
                (err) => {
                    globalLogger.error("Clipboard read failed", { err });
                    notify(
                        "Can't read the clipboard",
                        process.platform === "linux"
                            ? "Install xsel, xclip or wl-clipboard (Wayland) so Goblin Malin can read it."
                            : "The system clipboard could not be read."
                    );
                }
            );
        },
        [activeWindow, openConfirmModal, theme]
    );

    const askAboutArchived = useCallback(
        (tasks: MusicTask[], archivedTasks: MusicTask[]) => {
            const archivedIds = new Set(archivedTasks.map((t) => t.getId()));
            const n = archivedTasks.length;
            openConfirmModal({
                title: "Already archived",
                message: `${n} of ${tasks.length} URL${tasks.length === 1 ? " is" : "s are"} already in the archive (restore from Archive instead).`,
                choices: [
                    { label: "Skip archived", color: theme.action.primary },
                    { label: "Import anyway", color: theme.status.warning },
                ],
                accentColor: theme.status.warning,
                onConfirm: (i) => importTasks(i === 1 ? tasks : tasks.filter((t) => !archivedIds.has(t.getId()))),
            });
        },
        [openConfirmModal, theme]
    );

    const handleImportConfirm = useCallback(
        ({ fetchMetadata, download }: { fetchMetadata: boolean; download: boolean }) => {
            if (!pendingImport) {
                setPendingImport(null);
                return;
            }
            const urls = pendingImport.urls.map((d) => d.raw);
            const tasks = createTasksFromUrls(urls, { toTag: fetchMetadata, toDownload: download });
            setPendingImport(null);

            // Task ids derive from the URL, so a re-imported track matches its archived self.
            const archivedIds = getArchivedTaskIds(SessionManager.getInstance().getCurrentSession());
            const archivedTasks = tasks.filter((t) => archivedIds.has(t.getId()));
            if (archivedTasks.length === 0) {
                importTasks(tasks);
                return;
            }
            askAboutArchived(tasks, archivedTasks);
        },
        [pendingImport, askAboutArchived]
    );

    const handleImportCancel = useCallback(() => {
        setPendingImport(null);
    }, []);

    return { pendingImport, setPendingImport, openImportFlow, handleImportConfirm, handleImportCancel };
}
