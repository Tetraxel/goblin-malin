import { useState, useCallback } from "react";
import { DeleteConfirmRequest } from "#base/flow/deleteConfirmBridge";

export function useDeleteConfirmFlow() {
    const [pendingDelete, setPendingDelete] = useState<DeleteConfirmRequest | null>(null);

    const openDeleteConfirm = useCallback((request: DeleteConfirmRequest) => {
        setPendingDelete(request);
    }, []);

    const handleDeleteConfirm = useCallback(() => {
        pendingDelete?.apply();
        setPendingDelete(null);
    }, [pendingDelete]);

    const handleDeleteCancel = useCallback(() => {
        setPendingDelete(null);
    }, []);

    return { pendingDelete, openDeleteConfirm, handleDeleteConfirm, handleDeleteCancel };
}
