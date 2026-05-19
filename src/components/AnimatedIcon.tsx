import React from "react";
import { Text } from "ink";
import { useGlobalTicker } from "#hooks/useGlobalTicker";
import { SettingsStore } from "#settings/settingsStore";

export enum Icon {
    Dots = "dots",
    RotatingLight = "rotatingLight",
    Hourglass = "hourglass",
    RedFlag = "redFlag",
    Warning = "warning",
}

// Animation frames for different status types
const ANIMATION_FRAMES = {
    [Icon.Dots]: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    [Icon.RotatingLight]: ["🚨", ""],
    [Icon.RedFlag]: ["🚩", "  "],
    [Icon.Hourglass]: ["⏳", "⌛"],
    [Icon.Warning]: ["▵", " "],
};

const ICON_COLOR: Record<Icon, string> = {
    [Icon.Dots]: "white",
    [Icon.RotatingLight]: "white",
    [Icon.Hourglass]: "white",
    [Icon.RedFlag]: "white",
    [Icon.Warning]: "yellow",
};

interface AnimatedIconProps {
    icon: Icon;
    interval?: number; // Animation speed in ms
}

export const AnimatedIcon: React.FC<AnimatedIconProps> = ({ icon, interval = 500 }) => {
    // Instead of a local setInterval, we ask the global ticker for the count
    const globalTick = useGlobalTicker(interval);

    const frames = ANIMATION_FRAMES[icon];

    if (!frames || frames.length === 0) return null;

    // Use modulo to cycle through frames based on the global infinite counter
    const animationsEnabled = SettingsStore.getInstance().getAppSettings().general.animationsEnabled;
    const frameIndex = animationsEnabled ? globalTick % frames.length : 0;
    const currentFrame = frames[frameIndex];

    const color = ICON_COLOR[icon];

    return <Text color={color}>{currentFrame}</Text>;
};
