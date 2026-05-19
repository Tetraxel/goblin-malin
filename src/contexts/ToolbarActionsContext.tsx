import React, { createContext, useContext, useRef, ReactNode, MutableRefObject } from "react";

type ToolbarActionsRef = MutableRefObject<((() => void) | undefined)[]>;

const ToolbarActionsContext = createContext<ToolbarActionsRef | null>(null);

export const useToolbarActionsRef = (): ToolbarActionsRef => {
    const ref = useContext(ToolbarActionsContext);
    if (!ref) throw new Error("useToolbarActionsRef must be used within ToolbarActionsProvider");
    return ref;
};

export const ToolbarActionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const actionsRef = useRef<((() => void) | undefined)[]>([]);
    return <ToolbarActionsContext.Provider value={actionsRef}>{children}</ToolbarActionsContext.Provider>;
};
