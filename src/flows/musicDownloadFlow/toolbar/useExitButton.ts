import { ToolbarButtonHook } from '../../../components/Toolbar';
import { cache } from '../../../utils/cache';

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

export const useExitButton: ToolbarButtonHook = () => {
    return {
        label: "Exit",
        icon: "↳",
        color: "red",
        enabled: true,
        onPress: () => {
            process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
            console.info("Saving cache before exit…");
            cache.save();
            process.exit(0);
        },
    };
};
