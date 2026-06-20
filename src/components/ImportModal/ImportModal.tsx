import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useShortcuts } from "#hooks/useShortcuts";
import { useFocusContext } from "#contexts/FocusContext";
import { DetectedUrl, SupportedPlatform } from "./detectUrls";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";

export type PendingImport = {
    urls: DetectedUrl[];
    fetchMetadata: boolean;
    download: boolean;
};

interface ImportModalProps {
    pendingImport: PendingImport | null;
    terminalHeight: number;
    terminalWidth: number;
    onConfirm: (opts: { fetchMetadata: boolean; download: boolean }) => void;
    onCancel: () => void;
}

type ActionOption = {
    label: string;
    fetchMetadata: boolean;
    download: boolean;
};

const OPTIONS: ActionOption[] = [
    { label: "Fetch Metadata & Download", fetchMetadata: true, download: true },
    { label: "Fetch Metadata", fetchMetadata: true, download: false },
    { label: "Do nothing", fetchMetadata: false, download: false },
];

function platformBadge(platform: SupportedPlatform): {
    label: string;
    color: string;
} {
    const display = providerDisplayRegistry.get(platform);
    return { label: display.label, color: display.color };
}

function truncateUrl(str: string, max: number): string {
    if (str.length <= max) return str;
    if (max <= 1) return str.slice(0, max);
    return str.slice(0, max - 1) + "…";
}

export const ImportModal: React.FC<ImportModalProps> = ({
    pendingImport,
    terminalHeight,
    terminalWidth,
    onConfirm,
    onCancel,
}) => {
    const theme = useTheme();
    const { focusState, switchWindow, switchBack } = useFocusContext();
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [prevPendingImport, setPrevPendingImport] = useState(pendingImport);
    if (prevPendingImport !== pendingImport) {
        setPrevPendingImport(pendingImport);
        setSelectedIndex(0);
    }

    // Take focus while the modal is rendered; restore on unmount
    useEffect(() => {
        if (!pendingImport) return;
        switchWindow("importModal");
        return () => {
            switchBack();
        };
    }, [pendingImport, switchBack, switchWindow]);

    const isActive = pendingImport !== null && focusState.activeWindow === "importModal";

    useShortcuts({
        id: "importModal",
        isActive,
        exclusive: true,
        priority: 300,
        shortcuts: [
            {
                id: "importModal.cancel",
                defaultShortcut: { key: "escape" },
                label: "Cancel",
                handler: () => {
                    if (pendingImport) onCancel();
                },
            },
            {
                id: "importModal.confirm",
                defaultShortcut: { key: "return" },
                label: "Confirm",
                handler: () => {
                    if (!pendingImport) return;
                    const opt = OPTIONS[selectedIndex];
                    if (opt) onConfirm({ fetchMetadata: opt.fetchMetadata, download: opt.download });
                },
            },
            {
                id: "importModal.up",
                defaultShortcut: { key: "upArrow" },
                label: "Up",
                handler: () => setSelectedIndex((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length),
            },
            {
                id: "importModal.upTab",
                defaultShortcut: { key: "tab", shift: true },
                label: "Up",
                handler: () => setSelectedIndex((prev) => (prev - 1 + OPTIONS.length) % OPTIONS.length),
            },
            {
                id: "importModal.down",
                defaultShortcut: { key: "downArrow" },
                label: "Down",
                handler: () => setSelectedIndex((prev) => (prev + 1) % OPTIONS.length),
            },
            {
                id: "importModal.downTab",
                defaultShortcut: { key: "tab" },
                label: "Down",
                handler: () => setSelectedIndex((prev) => (prev + 1) % OPTIONS.length),
            },
        ],
    });

    if (!pendingImport) return null;

    const modalWidth = Math.min(80, Math.max(40, terminalWidth - 10));

    // Fixed rows consumed by the modal shell: border(2) + paddingY(2) + title(1)
    // + margin+urls-section-header(1) + margin+options(1+3) + margin+hint(1+1) = 12
    // Plus the outer paddingTop={3}.
    const FIXED_ROWS = 15;
    const MAX_URL_ROWS = 30;
    const BOTTOM_PADDING = 3;
    const availableRows = Math.max(1, terminalHeight - FIXED_ROWS - BOTTOM_PADDING);
    const totalUrls = pendingImport.urls.length;

    let visibleCount = Math.min(MAX_URL_ROWS, totalUrls);
    const hiddenAfterCap = totalUrls - visibleCount;
    // If there are hidden URLs, the overflow line consumes one extra row.
    if (visibleCount + (hiddenAfterCap > 0 ? 1 : 0) > availableRows) {
        // Always at least one hidden after trimming, so reserve a row for the line.
        visibleCount = Math.max(0, availableRows - 1);
    }
    const hiddenCount = totalUrls - visibleCount;
    const visibleUrls = pendingImport.urls.slice(0, visibleCount);

    const labelWidth =
        visibleUrls.length === 0 ? 0 : Math.max(...visibleUrls.map((u) => platformBadge(u.platform).label.length)) + 3; // [label] + 1 space
    const urlMaxWidth = modalWidth - labelWidth - 8; // subtract label col and type col

    const title = totalUrls === 1 ? "Import 1 URL" : `Import ${totalUrls} URLs`;

    return (
        <Box position="absolute" width="100%" height={terminalHeight} flexDirection="column" paddingTop={3}>
            <Box width="100%" justifyContent="center">
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={theme.ui.modalBorder}
                    borderBackgroundColor={theme.ui.background}
                    paddingX={2}
                    paddingY={1}
                    width={modalWidth}
                    backgroundColor={theme.ui.background}
                >
                    <Text bold color={theme.ui.modalBorder}>
                        {title}
                    </Text>

                    <Box marginTop={1} flexDirection="column">
                        {visibleUrls.map((url, idx) => {
                            const { label, color } = platformBadge(url.platform);
                            return (
                                <Box key={idx} flexDirection="row">
                                    <Box width={labelWidth} minWidth={labelWidth}>
                                        <Text color={color} bold>
                                            [{label}]
                                        </Text>
                                    </Box>
                                    <Box flexGrow={1}>
                                        <Text wrap="truncate-end">{truncateUrl(url.raw, urlMaxWidth)}</Text>
                                    </Box>
                                    <Box width={8} minWidth={8} justifyContent="flex-end">
                                        <Text dimColor>{url.type}</Text>
                                    </Box>
                                </Box>
                            );
                        })}
                        {hiddenCount > 0 && (
                            <Text dimColor>
                                and {hiddenCount} other {hiddenCount === 1 ? "URL" : "URLs"}...
                            </Text>
                        )}
                    </Box>

                    <Box marginTop={1} flexDirection="column">
                        {OPTIONS.map((opt, idx) => {
                            const isSelected = idx === selectedIndex;
                            return (
                                <Box key={idx}>
                                    <Text bold={isSelected} color={isSelected ? theme.ui.focusIndicator : undefined}>
                                        {isSelected ? "☛ " : "  "}
                                        {opt.label}
                                    </Text>
                                </Box>
                            );
                        })}
                    </Box>

                    <Box marginTop={1}>
                        <Text dimColor>[ENTER] Confirm · [↑↓] Select · [ESC] Cancel</Text>
                    </Box>
                </Box>
            </Box>

            <Box flexGrow={1} />
        </Box>
    );
};
