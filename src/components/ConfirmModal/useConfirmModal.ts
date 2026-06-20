import { useState, useCallback } from "react";

export interface ConfirmModalChoice {
    label: string;
    color: string;
}

export interface ConfirmModalConfig {
    title: string;
    message: string;
    choices: ConfirmModalChoice[];
    accentColor: string;
    onConfirm: (index: number) => void;
    onCancel?: () => void;
}

export function useConfirmModal() {
    const [pendingConfig, setPendingConfig] = useState<ConfirmModalConfig | null>(null);

    const openConfirmModal = useCallback((config: ConfirmModalConfig) => {
        setPendingConfig(config);
    }, []);

    const handleConfirm = useCallback(
        (index: number) => {
            pendingConfig?.onConfirm(index);
            setPendingConfig(null);
        },
        [pendingConfig]
    );

    const handleCancel = useCallback(() => {
        pendingConfig?.onCancel?.();
        setPendingConfig(null);
    }, [pendingConfig]);

    return { pendingConfig, openConfirmModal, handleConfirm, handleCancel };
}
