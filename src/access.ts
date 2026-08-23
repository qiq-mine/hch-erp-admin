import { canAccess, type RolePolicy } from '@/config/roles';
import type { DomainKey, RoleKey } from '@/domain/types';
import type { RolePrincipal } from '@/services/enterprise';

export interface AccessInitialState {
  activeRole?: RoleKey;
  currentPolicy?: RolePolicy;
  currentPrincipal?: RolePrincipal;
  initializationError?: string;
}

const DOMAINS: readonly DomainKey[] = [
  'dashboard',
  'sales',
  'planning',
  'manufacturing',
  'warehouse',
  'finance',
  'integration',
  'security',
];

export default function access(initialState?: AccessInitialState) {
  const activeRole = initialState?.activeRole;
  if (
    !activeRole || !initialState.currentPolicy || !initialState.currentPrincipal ||
    initialState.initializationError
  ) {
    return {
      ...Object.fromEntries(DOMAINS.map((domain) => [domain, false])) as Record<DomainKey, boolean>,
      permissionChange: false,
      resetDemo: false,
    };
  }
  const overrides = { [activeRole]: initialState.currentPolicy };
  const domainAccess = Object.fromEntries(
    DOMAINS.map((domain) => [domain, canAccess(activeRole, domain, 'read', overrides)]),
  ) as Record<DomainKey, boolean>;

  return {
    ...domainAccess,
    permissionChange: canAccess(activeRole, 'security', 'permission-change', overrides),
    resetDemo: canAccess(activeRole, 'security', 'reset-demo', overrides),
  };
}
