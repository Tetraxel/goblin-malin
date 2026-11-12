import { providerDisplayRegistry } from "#base/providerDisplay";
import { type Theme } from "#base/theme";
import { blend, darken, isLight, lighten } from "#utils/color";
import { type AttributesTint } from "./FocusRow";

/**
 * The colours of the MusicBrainz block, the same shape as the yellow "File attributes" one, built from MusicBrainz'
 * own colours (`providerDisplayRegistry`, never hardcoded here): a dark tint on a dark theme, a pale one on a light theme.
 */
export function musicBrainzTint(theme: Theme): AttributesTint {
    const { colorSubtle, colorBright } = providerDisplayRegistry.get("musicBrainz");
    if (isLight(theme.fileAttributes.background)) {
        return {
            header: colorBright,
            headerText: "#ffffff",
            background: lighten(blend(colorBright, "#ffffff", 0.2), 0.75),
            label: colorSubtle,
            value: theme.fileAttributes.value,
        };
    }
    return {
        header: colorSubtle,
        headerText: "#ffffff",
        background: darken(colorSubtle, 0.45),
        label: colorBright,
        value: theme.fileAttributes.value,
    };
}
