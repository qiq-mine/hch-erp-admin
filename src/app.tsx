import { RoleSwitcher } from '@/components/RoleSwitcher';
import type { ReactNode } from 'react';
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
  <ErrorBoundary>{container}</ErrorBoundary>
);

export const layout = ({ initialState }: { initialState?: AppInitialState }) => ({
  title: PRODUCT_NAME,
  logo: false,
  menu: { locale: false },
  menuHeaderRender: () => <span>{PRODUCT_NAME}</span>,
  actionsRender: ({ collapsed }: { collapsed?: boolean }) => [
    <RoleSwitcher compact={collapsed} key="role-switcher" />,
  ],
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
