import { useCallback, useState } from "react";
import { type InputDialog } from "#base/bridges/dialogBridge";
import { type PendingInputDialog } from "./InputDialogModal";

/** The input dialog on screen. The bridge hands over one at a time (it queues the rest), so this only holds the current one. */
export function useInputDialog() {
    const [pending, setPending] = useState<PendingInputDialog | null>(null);

    const open = useCallback((dialog: InputDialog, resolve: (value: string | null) => void) => {
        setPending({ dialog, resolve });
    }, []);

    // No manual useCallback: the React Compiler memoizes this, and cannot preserve a hand-written one that calls a
    // function held in state.
    const answer = (value: string | null) => {
        pending?.resolve(value);
        setPending(null);
    };

    return { pending, open, answer };
}
