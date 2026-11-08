import { useState, useCallback, useRef } from "react";

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
    // What is on screen right now, readable from a callback without waiting for a render, and the dialogs
    // waiting for it to close (see openConfirmModalWhenFree).
    const shownRef = useRef<ConfirmModalConfig | null>(null);
    const waitingRef = useRef<ConfirmModalConfig[]>([]);

    const show = useCallback((config: ConfirmModalConfig | null) => {
        shownRef.current = config;
        setPendingConfig(config);
    }, []);

    /** Shows `config` now, replacing any dialog already open. */
    const openConfirmModal = useCallback((config: ConfirmModalConfig) => show(config), [show]);

    /**
     * Shows `config` once no dialog is open — in the order requested. For notices raised by background work at
     * an arbitrary moment: they must not replace a dialog the user is answering (the replaced dialog's own
     * promise would never settle).
     */
    const openConfirmModalWhenFree = useCallback(
        (config: ConfirmModalConfig) => {
            if (shownRef.current) waitingRef.current.push(config);
            else show(config);
        },
        [show]
    );

    const handleConfirm = useCallback(
        (index: number) => {
            pendingConfig?.onConfirm(index);
            show(waitingRef.current.shift() ?? null);
        },
        [pendingConfig, show]
    );

    const handleCancel = useCallback(() => {
        pendingConfig?.onCancel?.();
        show(waitingRef.current.shift() ?? null);
    }, [pendingConfig, show]);

    return { pendingConfig, openConfirmModal, openConfirmModalWhenFree, handleConfirm, handleCancel };
}
