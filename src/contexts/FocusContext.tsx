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
  value: FocusContextValue;
}> = ({ children, value }) => {
  return (
    <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
  );
};
