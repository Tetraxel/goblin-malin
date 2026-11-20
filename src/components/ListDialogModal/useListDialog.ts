import { useCallback, useState } from "react";
import { type ListDialogAnswer, type ListDialog } from "#base/bridges/dialogBridge";
import { type PendingListDialog } from "./ListDialogModal";

/** The list dialog on screen. The bridge hands over one at a time (it queues the rest), so this only holds the current one. */
export function useListDialog() {
    const [pending, setPending] = useState<PendingListDialog | null>(null);

    const open = useCallback((dialog: ListDialog, resolve: (answer: ListDialogAnswer) => void) => {
        setPending({ dialog, resolve });
    }, []);

    // No manual useCallback: the React Compiler memoizes this, and cannot preserve a hand-written one that calls a
    // function held in state.
    const answer = (value: ListDialogAnswer) => {
        pending?.resolve(value);
        setPending(null);
    };

    return { pending, open, answer };
}
