import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { AnimatedIcon, Icon } from "#components/AnimatedIcon";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { providerDisplayRegistry } from "#base/providerDisplay";

/**
 * A filled button in MusicBrainz' own purple (brighter under the pointer), so it cannot be mistaken for the plain
 * text around it. Clickable. While `busy` it shows `busyLabel` with a spinner on a darker shade and ignores clicks.
 */
export const MusicBrainzButton = React.memo(function MusicBrainzButton({
    label,
    onClick,
    busy = false,
    busyLabel = "Working…",
}: {
    label: string;
    onClick: () => void;
    busy?: boolean;
    busyLabel?: string;
}) {
    const brand = providerDisplayRegistry.get("musicBrainz");
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, () => {
        if (!busy) onClick();
    });
    const hovered = useHoverTarget(ref);

    return (
        <Box flexDirection="row" height={1} flexShrink={0}>
            <Box
                ref={ref}
                paddingX={1}
                flexShrink={0}
                backgroundColor={busy ? brand.colorSubtle : hovered ? brand.colorBright : brand.color}
            >
                {busy ? (
                    <Text color="white">
                        <AnimatedIcon icon={Icon.Dots} interval={125} color="white" /> {busyLabel}
                    </Text>
                ) : (
                    <Text color="white" bold wrap="truncate-end">
                        {label}
                    </Text>
                )}
            </Box>
        </Box>
    );
});

/**
 * The "run the MusicBrainz check again" call-to-action: shown when the sources changed since the last check, or when
 * there has been none. The same button appears under the compiled row (left) and in the compiled metadata (right):
 * `busy` is held by their parent, so both show the same state.
 */
export const MusicBrainzRecheckButton = React.memo(function MusicBrainzRecheckButton({
    label,
    busy,
    onRecheck,
}: {
    label: string;
    busy: boolean;
    onRecheck: () => void;
}) {
    return <MusicBrainzButton label={label} busy={busy} busyLabel="Checking MusicBrainz…" onClick={onRecheck} />;
});
