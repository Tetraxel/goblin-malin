import { PROJECT_ROOT } from '../constants';

export type AppSettings = {
  general: {
    reopenLastSession: boolean;
    appDataDir: string;
    animationsEnabled: boolean;
    theme: string;
  };
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    reopenLastSession: false,
    appDataDir: PROJECT_ROOT,
    animationsEnabled: false,
    theme: 'dark',
  },
};
