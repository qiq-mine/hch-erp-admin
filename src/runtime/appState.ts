import { PRODUCT_NAME } from '@/config/product';
import { canAccess, FAIL_CLOSED_POLICY, ROLE_POLICIES, type RolePolicy } from '@/config/roles';
import type { DomainKey, RoleKey } from '@/domain/types';
import { getBrowserRoleStorage, readCommittedRole, type RoleStorage } from '@/models/role';
import {
  enterpriseRepository,
  type EnterpriseRepository,
  type RolePrincipal,
} from '@/services/enterprise';

export interface AppInitialState {
  authorizationGeneration?: number;
  authorizationToken?: string;
  activeRole?: RoleKey;
  currentPolicy: RolePolicy;
  currentPrincipal?: RolePrincipal;
  dataRevision: number;
  initializationError?: string;
}

export interface RoleMenuItem {
  children?: RoleMenuItem[];
  name?: string;
  path?: string;
  [key: string]: unknown;
}

const DOMAIN_PATHS: ReadonlyArray<readonly [string, DomainKey]> = [
  ['/dashboard', 'dashboard'],
  ['/sales', 'sales'],
  ['/planning', 'planning'],
  ['/manufacturing', 'manufacturing'],
  ['/warehouse', 'warehouse'],
  ['/finance', 'finance'],
  ['/integration', 'integration'],
  ['/security', 'security'],
];

function domainForPath(path?: string): DomainKey | undefined {
  if (!path) return undefined;
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  if (pathname === '/') return 'dashboard';
  return DOMAIN_PATHS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )?.[1];
}

export function filterMenuByRole<T extends RoleMenuItem>(
  menuData: readonly T[],
  role: RoleKey | undefined,
  policy?: RolePolicy,
): T[] {
  const overrides = policy && role ? { [role]: policy } : undefined;

  return menuData.flatMap((item) => {
    const domain = domainForPath(item.path);
    if (domain && (!role || !canAccess(role, domain, 'read', overrides))) return [];
    if (
      item.path === '/security/permissions' &&
      (!role || !canAccess(role, 'security', 'permission-change', overrides))
    ) return [];

    const cloned = { ...item } as T;
    if (item.children) {
      cloned.children = filterMenuByRole(item.children, role, policy);
      if (!item.path && cloned.children.length === 0) return [];
    }
    return [cloned];
  });
}

export async function loadInitialState(
  repository: Pick<EnterpriseRepository, 'getRolePolicy' | 'getRolePrincipal'> = enterpriseRepository,
  storage?: RoleStorage,
): Promise<AppInitialState> {
  let activeRole: RoleKey | undefined;
  try {
    const resolvedStorage = storage ?? getBrowserRoleStorage();
    activeRole = readCommittedRole(resolvedStorage);
  } catch {
    return {
      activeRole: undefined,
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 0,
      initializationError: '角色视角恢复失败',
    };
  }

  try {
    const [currentPolicy, currentPrincipal] = await Promise.all([
      repository.getRolePolicy(activeRole),
      repository.getRolePrincipal(activeRole),
    ]);
    if (!currentPrincipal) {
      return {
        activeRole,
        currentPolicy: FAIL_CLOSED_POLICY,
        currentPrincipal: undefined,
        dataRevision: 0,
        initializationError: `${ROLE_POLICIES[activeRole].label}暂无启用用户`,
      };
    }
    return { activeRole, currentPolicy, currentPrincipal, dataRevision: 0 };
  } catch {
    return {
      activeRole,
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 0,
      initializationError: '权限策略加载失败',
    };
  }
}

export { PRODUCT_NAME };
