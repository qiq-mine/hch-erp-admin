import type { ReactNode } from 'react';
import { AppThemeProvider } from '@/components/AppThemeProvider';
import { NavigationHeader } from '@/components/NavigationActions';
import { ErrorBoundary } from '@/pages/Exception/ErrorBoundary';
import { PRODUCT_NAME } from '@/config/product';
import { FAIL_CLOSED_POLICY } from '@/config/roles';
import {
  filterMenuByRole,
  loadInitialState,
  type AppInitialState,
  type RoleMenuItem,
} from '@/runtime/appState';

export type { AppInitialState, RoleMenuItem } from '@/runtime/appState';

export const getInitialState = () => loadInitialState();

export const rootContainer = (container: ReactNode) => (
  <AppThemeProvider>
    <ErrorBoundary>{container}</ErrorBoundary>
  </AppThemeProvider>
);

export const layout = ({ initialState }: { initialState?: AppInitialState }) => ({
  title: PRODUCT_NAME,
  layout: 'mix' as const,
  logo: false,
  menu: { locale: false },
  splitMenus: false,
  menuHeaderRender: false,
  actionsRender: false,
  headerContentRender: (_props: unknown, defaultDom: ReactNode) => (
    <NavigationHeader defaultDom={defaultDom} />
  ),
  menuDataRender: <T extends RoleMenuItem>(menuData: readonly T[]) => {
    const policyReady = Boolean(
      initialState?.activeRole && initialState.currentPolicy && initialState.currentPrincipal &&
      !initialState.initializationError,
    );
    return filterMenuByRole(
      menuData,
      policyReady ? initialState?.activeRole : undefined,
      policyReady ? initialState?.currentPolicy : FAIL_CLOSED_POLICY,
    );
  },
});
