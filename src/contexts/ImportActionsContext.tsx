import React, { createContext, useContext, ReactNode } from 'react';

type ImportActionsValue = {
  openImportFlow: (text?: string) => void;
};

const ImportActionsContext = createContext<ImportActionsValue | null>(null);

export const useImportActions = (): ImportActionsValue => {
  const ctx = useContext(ImportActionsContext);
  if (!ctx) throw new Error('useImportActions must be used within ImportActionsProvider');
  return ctx;
};

export const ImportActionsProvider: React.FC<{
  children: ReactNode;
  openImportFlow: (text?: string) => void;
}> = ({ children, openImportFlow }) => {
  return (
    <ImportActionsContext.Provider value={{ openImportFlow }}>
      {children}
    </ImportActionsContext.Provider>
  );
};
