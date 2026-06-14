import { useState, useCallback } from "react";
import { StartOptionsRequest } from "#types/actions";

export function useStartFlow() {
    const [pendingStart, setPendingStart] = useState<StartOptionsRequest | null>(null);

    const openStartFlow = useCallback((request: StartOptionsRequest) => {
        setPendingStart(request);
    }, []);

    const handleStartConfirm = useCallback(
        (opts: { toTag: boolean; toDownload: boolean }) => {
            pendingStart?.apply(opts);
            setPendingStart(null);
        },
        [pendingStart]
    );

    const handleStartCancel = useCallback(() => {
        setPendingStart(null);
    }, []);

    return { pendingStart, openStartFlow, handleStartConfirm, handleStartCancel };
}
