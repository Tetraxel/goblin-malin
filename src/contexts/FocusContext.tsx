import React, { createContext, useContext, ReactNode } from "react";
import { useFocusManager } from "../hooks/useFocusManager";

type FocusContextValue = ReturnType<typeof useFocusManager>;

const FocusContext = createContext<FocusContextValue | null>(null);

export const useFocusContext = () => {
  const context = useContext(FocusContext);
  if (!context) {
    throw new Error("useFocus must be used within FocusProvider");
  }
  return context;
};

export const FocusProvider: React.FC<{
  children: ReactNode;
  toolbarButtonCount: number;
  taskCount: number;
  taskColumnCount: number;
}> = ({ children, ...config }) => {
  const focusManager = useFocusManager(config); // ← moved here
  return (
    <FocusContext.Provider value={focusManager}>
      {children}
    </FocusContext.Provider>
  );
};
