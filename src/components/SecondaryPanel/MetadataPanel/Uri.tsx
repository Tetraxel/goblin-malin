import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { darken } from "#utils/color";

interface MetadataUriProps {
    uri: string;
    platform: string;
    fetchState?: "loading" | "error";
    dimmed?: boolean;
    fetchedBy?: string;
    noPaddingX?: boolean;
}

export const Uri: React.FC<MetadataUriProps> = ({ uri, platform, fetchState, dimmed, fetchedBy, noPaddingX }) => {
    const theme = useTheme();
    const parts = uri.split("::");
    const display = providerDisplayRegistry.get(platform);

    if (fetchState === "loading") {
        return (
            <Box flexDirection="row" flexShrink={0} height={1} backgroundColor={darken(theme.palette.gray, 0.2)}>
                <Text color={theme.text.secondary} dimColor>
                    <Spinner type="dots" />
                </Text>
                <Text color={theme.text.secondary} dimColor wrap="truncate-end">
                    {" " + uri}
                </Text>
            </Box>
        );
    }

    if (fetchState === "error") {
        return (
            <Box flexDirection="row" flexShrink={0} height={1} backgroundColor={darken(theme.status.error, 0.2)}>
                <Text color={theme.status.error}>{"✘ "}</Text>
                <Text color={theme.status.error} wrap="truncate-end">
                    {uri}
                </Text>
            </Box>
        );
    }

    const fetchedByDisplay = fetchedBy ? providerDisplayRegistry.get(fetchedBy) : null;

    return (
        <Box
            flexDirection="row"
            flexShrink={0}
            height={1}
            paddingX={noPaddingX ? 0 : 1}
            backgroundColor={darken(display.color, 0.2)}
        >
            {parts.map((part, i) => (
                <React.Fragment key={i}>
                    {i > 0 && (
                        <Text color={theme.text.secondary} dimColor={dimmed} wrap="truncate-end">
                            {"::"}
                        </Text>
                    )}
                    <Text color={display.color} dimColor={dimmed} wrap="truncate-end">
                        {part}
                    </Text>
                </React.Fragment>
            ))}
            {fetchedByDisplay && (
                <>
                    <Text color={theme.text.primary} dimColor={dimmed}>
                        {" ("}
                    </Text>
                    <Text color={fetchedByDisplay.color} dimColor={dimmed}>
                        {fetchedByDisplay.label}
                    </Text>
                    <Text color={theme.text.primary} dimColor={dimmed}>
                        {")"}
                    </Text>
                </>
            )}
        </Box>
    );
};
