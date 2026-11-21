import { useCallback, useState } from "react";
import { type MatrixAnswer, type MatrixDialog } from "#base/bridges/dialogBridge";
import { type PendingMatrixDialog } from "./MatrixDialogModal";

/** The matrix dialog on screen. The bridge hands over one at a time (it queues the rest), so this only holds the current one. */
export function useMatrixDialog() {
    const [pending, setPending] = useState<PendingMatrixDialog | null>(null);

    const open = useCallback((dialog: MatrixDialog, resolve: (answer: MatrixAnswer) => void) => {
        setPending({ dialog, resolve });
    }, []);

    // No manual useCallback: the React Compiler memoizes this, and cannot preserve a hand-written one that calls a
    // function held in state.
    const answer = (value: MatrixAnswer) => {
        pending?.resolve(value);
        setPending(null);
    };

    return { pending, open, answer };
}
