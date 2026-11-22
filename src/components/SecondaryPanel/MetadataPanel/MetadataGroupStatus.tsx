import React, { useCallback, useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { useTheme } from "#base/themeContext";
import { useShortcutLiteral } from "#hooks/useShortcutLiteral";
import { type MetadataGroupState } from "#flows/musicDownloadFlow/types";

/** The "Skip ⏭" button: stops waiting and keeps what was found so far. Clickable. */
export const SkipButton = React.memo(function SkipButton({
    onSkip,
    label = "Skip ⏭",
}: {
    onSkip: () => void;
    label?: string;
}) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onSkip);
    const isHovered = useHoverTarget(ref);
    return (
        <Box
            ref={ref}
            marginLeft={1}
            paddingX={1}
            flexShrink={0}
            backgroundColor={isHovered ? theme.ui.rowBackground.regular.hover : undefined}
        >
            <Text color={theme.text.active} bold>
                {label}
            </Text>
        </Box>
    );
});

/** Under a group header while its platform is being searched: a spinner, and a Skip for this platform only. */
export const GroupSearchRow = React.memo(function GroupSearchRow({
    serviceKey,
    onSkip,
}: {
    serviceKey: string;
    /** Must be referentially stable so the memo holds. */
    onSkip: (serviceKey: string) => void;
}) {
    const theme = useTheme();
    const skip = useCallback(() => onSkip(serviceKey), [onSkip, serviceKey]);
    return (
        <Box flexDirection="row" height={1} paddingLeft={3} flexShrink={0} overflow="hidden">
            <Box flexDirection="row" paddingRight={1} flexShrink={0}>
                <Text color={theme.text.secondary}>
                    <AnimatedIcon icon={Icon.Dots} interval={125} color={theme.text.secondary} />
                </Text>
            </Box>
            <Text color={theme.text.secondary} wrap="truncate-end">
                Searching…
            </Text>
            <SkipButton onSkip={skip} />
        </Box>
    );
});

/**
 * What a group header says when its platform ended up with no result, so an empty group is never mistaken for an
 * unfinished one. (Not for a group still being searched: it has its own row, `GroupSearchRow`.)
 */
export function emptyGroupText(search: MetadataGroupState["search"]): string {
    if (search === "skipped") return "Search skipped, nothing found yet";
    if (search === "failed") return "Search failed, nothing found";
    return "Nothing found";
}

/**
 * A button at the bottom of the sources that asks an on-request discovery service (Songlink, Claude) to look for the
 * platforms still missing. In the provider's own colors (brighter under the pointer), with the live key of its shortcut. While `busy`
 * it shows a spinner, and a click (or the same key) stops the service.
 */
export const LastResortButton = React.memo(function LastResortButton({
    serviceKey,
    missingText,
    showKey = true,
    busy,
    onAsk,
    onStop,
}: {
    serviceKey: string;
    /** The platforms it would look for, as one text ("YouTube, Deezer"): a primitive, so the memo holds. */
    missingText: string;
    /** Whether the shortcut acts on this button (it asks the first one, or stops the one running). */
    showKey?: boolean;
    busy: boolean;
    /** Must be referentially stable so the memo holds. */
    onAsk: (serviceKey: string) => void;
    /** Must be referentially stable so the memo holds. */
    onStop: () => void;
}) {
    const brand = providerDisplayRegistry.get(serviceKey);
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, () => {
        if (busy) onStop();
        else onAsk(serviceKey);
    });
    const hovered = useHoverTarget(ref);
    const literal = useShortcutLiteral("sourceList.askLastResort");
    const key = showKey ? literal : undefined;

    return (
        <Box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
            <Box
                ref={ref}
                paddingX={1}
                flexShrink={1}
                backgroundColor={busy && !hovered ? brand.colorSubtle : hovered ? brand.colorBright : brand.color}
            >
                {busy ? (
                    <Text color="white" wrap="truncate-end">
                        <AnimatedIcon icon={Icon.Dots} interval={125} color="white" /> {brand.label} is looking…
                        {`  Stop${key ? ` [${key}]` : ""}`}
                    </Text>
                ) : (
                    <Text color="white" bold wrap="truncate-end">
                        {`Ask ${brand.label} to look for ${missingText}`}
                        {key ? `  [${key}]` : ""}
                    </Text>
                )}
            </Box>
        </Box>
    );
});
