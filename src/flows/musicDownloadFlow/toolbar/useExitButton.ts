import { useEffect, useState } from 'react';
import { ToolbarButtonHook } from '../../../components/Toolbar';
import { useInput } from 'ink';
import { cache } from '../../../utils/cache';

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

export const useExitButton: ToolbarButtonHook = ({ isSelected }: { isSelected: boolean }) => {
    useInput(
        (input, key) => {
            if (key.return) {
                process.stdout.write(LEAVE_ALT_SCREEN_COMMAND);
                console.info("Saving cache before exit...");
                cache.save();
                process.exit(0);
            }
        },
        { isActive: isSelected }
    );
    return {
        label: "Exit",
        icon: "↳",
        color: "red",
        enabled: true,
    };
}
