import { ConfigProvider, theme as antdTheme } from 'antd';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'hch-erp:theme';

interface AppThemeContextValue {
  mode: ThemeMode;
  toggle: () => void;
}

const AppThemeContext = createContext<AppThemeContextValue>({
  mode: 'light',
  toggle: () => undefined,
});

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // The selected mode still applies for this session when storage is unavailable.
    }
  }, [mode]);

  const value = useMemo<AppThemeContextValue>(() => ({
    mode,
    toggle: () => setMode((current) => current === 'light' ? 'dark' : 'light'),
  }), [mode]);

  return (
    <AppThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark'
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </AppThemeContext.Provider>
  );
}

export const useAppTheme = () => useContext(AppThemeContext);
