import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type DownloadQueryField } from "#flows/musicDownloadFlow/types";

interface QueryLinesProps {
    query: DownloadQueryField[];
}

/**
 * What a download provider was actually asked for (the raw text of its search box, a URL, or several
 * fields) — as opposed to the "used …" header above it, which is the metadata the request came from.
 * Which fields exist is up to the provider; this just prints them. Greyed and indented under "used …": it is detail,
 * not the thing a row is about.
 */
export function QueryLines({ query }: QueryLinesProps) {
    const theme = useTheme();
    const labelWidth = Math.max(...query.map((field) => field.label.length));

    return (
        <Box marginLeft={7} flexDirection="column" flexShrink={0}>
            {query.map((field) => (
                <Box key={field.label} flexDirection="row" flexShrink={0}>
                    <Box flexShrink={0} paddingRight={1}>
                        <Text color={theme.text.secondary} dimColor>
                            ↳
                        </Text>
                    </Box>
                    <Box flexShrink={0} width={labelWidth + 1}>
                        <Text color={theme.text.secondary} dimColor>
                            {field.label}
                        </Text>
                    </Box>
                    <Box flexShrink={1}>
                        {field.value === "" ? (
                            <Text color={theme.text.secondary} dimColor>
                                (empty)
                            </Text>
                        ) : (
                            <Text color={theme.text.secondary}>{field.value}</Text>
                        )}
                    </Box>
                </Box>
            ))}
        </Box>
    );
}
