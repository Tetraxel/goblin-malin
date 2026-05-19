import { ToolbarButtonHook } from "../../../components/Toolbar/Toolbar";
import { cache } from "../../../utils/cache";
import { useTheme } from "../../../base/themeContext";

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

export const useExitButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    return {
        label: "Exit",
        icon: "↳",
        color: theme.action.destructive,
        enabled: true,
        onPress: () => {
            process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
            console.info("Saving cache before exit…");
            cache.save();
            process.exit(0);
        },
    };
};
