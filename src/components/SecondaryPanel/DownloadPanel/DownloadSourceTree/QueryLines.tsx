import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "#base/themeContext";
import { type QueryField } from "#flows/musicDownloadFlow/types";

interface QueryLinesProps {
    query: QueryField[];
    /** Columns to the left of the "↳" (under a download row's "used …" line by default). */
    indent?: number;
    /** Keep each field on one line, cutting a long value, where the lines under it are counted (a list row). */
    truncate?: boolean;
    /** Greyed out, like the rest of a row that was rejected. */
    dimmed?: boolean;
}

/**
 * What a download provider was actually asked for (the raw text of its search box, a URL, or several
 * fields) — as opposed to the "used …" header above it, which is the metadata the request came from.
 * Which fields exist is up to the provider; this just prints them. Greyed and indented under "used …": it is detail,
 * not the thing a row is about.
 */
export function QueryLines({ query, indent = 7, truncate = false, dimmed = false }: QueryLinesProps) {
    const theme = useTheme();
    const labelWidth = Math.max(...query.map((field) => field.label.length));

    return (
        <Box marginLeft={indent} flexDirection="column" flexShrink={0}>
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
                            <Text
                                color={theme.text.secondary}
                                dimColor={dimmed}
                                wrap={truncate ? "truncate-end" : "wrap"}
                            >
                                {field.value}
                            </Text>
                        )}
                    </Box>
                </Box>
            ))}
        </Box>
    );
}
