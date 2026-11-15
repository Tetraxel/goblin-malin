import { type ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useFocusActions } from "#contexts/FocusContext";
import { chatPanelState, useChatOpen } from "#components/ChatPanel/chatPanelState";

/** "Claude": opens the chat with Claude (P32) and puts the keyboard in it; pressed again it closes it. */
export const useChatButton: ToolbarButtonHook = () => {
    const { switchWindow } = useFocusActions();
    const open = useChatOpen();
    return {
        label: "Claude",
        icon: "✻",
        color: "#d97757",
        enabled: true,
        bold: open,
        onPress: () => {
            if (open) {
                chatPanelState.setOpen(false);
                switchWindow("taskList");
            } else {
                chatPanelState.setOpen(true);
                switchWindow("chatPanel");
            }
        },
    };
};
