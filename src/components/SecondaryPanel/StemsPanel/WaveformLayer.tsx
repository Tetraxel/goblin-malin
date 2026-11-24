import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { getScreenBounds } from "#base/mouse/screenBounds";
import { useClickTarget, useHoverTarget } from "#base/mouse/useMouseTarget";
import { useTheme } from "#base/themeContext";
import { formatDuration } from "../utils";
import { useWaveform } from "./useLayers";
import { waveformCells } from "./waveformCells";

/** Columns of the play button, the label, the S / M buttons and the time after the bar. */
const PLAY_WIDTH = 3;
export const LAYER_LABEL_WIDTH = 11;
const BUTTONS_WIDTH = 7;
export const LAYER_TIME_WIDTH = 14;

/** A one-cell button (`S`, `M`, `▶`): lit when on, underlined under the pointer, a click toggles it. */
function CellButton({ text, on, color, onPress }: { text: string; on: boolean; color: string; onPress: () => void }) {
    const theme = useTheme();
    const ref = useRef<DOMElement>(null);
    useClickTarget(ref, onPress);
    const hovered = useHoverTarget(ref);
    return (
        <Box ref={ref} flexShrink={0} marginRight={1}>
            <Text
                color={on ? theme.ui.background : hovered ? theme.text.active : theme.text.secondary}
                backgroundColor={on ? color : undefined}
                bold={on}
                underline={hovered}
            >
                {` ${text} `}
            </Text>
        </Box>
    );
}

type WaveformLayerProps = {
    label: string;
    color: string;
    path?: string;
    /** The file's length before the mixer has it (from its probe). */
    durationMs?: number;
    /** Where the mix is, when this track's layers are loaded; `undefined` otherwise. */
    positionMs?: number;
    mixLengthMs?: number;
    /** The layer is heard in the mix (not muted, or soloed). */
    audible: boolean;
    muted: boolean;
    soloed: boolean;
    /** The track's row carries the main play / pause of the mix. */
    main: boolean;
    playing: boolean;
    width: number;
    isFocused: boolean;
    isActive: boolean;
    onSelect: () => void;
    /** A click on the waveform: the mix plays from that fraction of it. */
    onSeek: (fraction: number) => void;
    onTogglePlay: () => void;
    onToggleMute: () => void;
    onToggleSolo: () => void;
};

/**
 * One layer of the Stems tab's player: (on the track's row) the play / pause of the whole mix, its name, its solo and
 * mute buttons, its waveform and the time. All the layers are one mix on one timeline: the played part is in the
 * layer's colour while it is heard, dim while it is muted.
 */
export function WaveformLayer(props: WaveformLayerProps) {
    const { label, color, path, durationMs, positionMs, mixLengthMs, audible, width, isFocused, isActive } = props;
    const theme = useTheme();
    const rowRef = useRef<DOMElement>(null);
    const barRef = useRef<DOMElement>(null);
    const playRef = useRef<DOMElement>(null);
    const peaks = useWaveform(path);
    const barWidth = Math.max(8, width - PLAY_WIDTH - LAYER_LABEL_WIDTH - BUTTONS_WIDTH - LAYER_TIME_WIDTH - 2);
    useClickTarget(rowRef, props.onSelect);
    useClickTarget(barRef, (event) => {
        const left = getScreenBounds(barRef.current)?.x ?? 0;
        if (path && barWidth > 1) props.onSeek(Math.max(0, Math.min(1, (event.x - left) / (barWidth - 1))));
    });
    useClickTarget(playRef, () => props.onTogglePlay());
    const playHovered = useHoverTarget(playRef);

    const length = mixLengthMs || durationMs || 0;
    const loaded = positionMs !== undefined;
    const position = positionMs ?? 0;
    const played = length > 0 && loaded ? Math.min(barWidth, Math.round((position / length) * barWidth)) : 0;
    const cells = path
        ? peaks
            ? waveformCells(peaks, barWidth)
            : peaks === null
              ? "─".repeat(barWidth)
              : "·".repeat(barWidth)
        : "";
    const bg = isFocused
        ? isActive
            ? theme.ui.rowBackground.regular.cellActive
            : theme.ui.rowBackground.regular.highlighted
        : undefined;
    const time = path ? `${loaded ? formatDuration(position) : "0:00"} / ${formatDuration(length)}` : "no file yet";

    return (
        <Box ref={rowRef} flexDirection="row" height={1} flexShrink={0} overflow="hidden" backgroundColor={bg}>
            <Box ref={playRef} flexShrink={0} width={PLAY_WIDTH}>
                {props.main ? (
                    <Text
                        color={props.playing ? theme.ui.progressFill : theme.text.primary}
                        bold
                        underline={playHovered}
                    >
                        {props.playing ? "⏸" : "▶"}
                    </Text>
                ) : (
                    <Text color={theme.action.primary}>{isFocused ? "›" : " "}</Text>
                )}
            </Box>
            <Box flexShrink={0} width={LAYER_LABEL_WIDTH}>
                <Text color={color} bold={audible} dimColor={!audible} wrap="truncate-end">
                    {label}
                </Text>
            </Box>
            <Box flexShrink={0} width={BUTTONS_WIDTH} flexDirection="row">
                <CellButton text="S" on={props.soloed} color={theme.status.warning} onPress={props.onToggleSolo} />
                <CellButton text="M" on={props.muted} color={theme.status.error} onPress={props.onToggleMute} />
            </Box>
            <Box ref={barRef} flexShrink={0} width={barWidth}>
                {/* Played: the layer's colour while heard, dim while muted. Still to play: grey, dimmer when muted. */}
                <Text color={color} dimColor={!audible}>
                    {cells.slice(0, played)}
                </Text>
                <Text color={theme.text.muted} dimColor={!audible}>
                    {cells.slice(played)}
                </Text>
            </Box>
            <Box flexShrink={0} width={LAYER_TIME_WIDTH} marginLeft={1}>
                <Text color={theme.text.secondary} wrap="truncate-end">
                    {time}
                </Text>
            </Box>
        </Box>
    );
}
