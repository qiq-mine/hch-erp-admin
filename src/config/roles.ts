import type {
  BusinessRecord,
  DataScope,
  DomainKey,
  PermissionAction,
  RoleKey,
} from '@/domain/types';

export interface RolePolicy {
  label: string;
  domains: readonly DomainKey[];
  actions: readonly (PermissionAction | '*')[];
  scope: DataScope;
}

const EMPTY_DOMAINS = Object.freeze([] as DomainKey[]);
const EMPTY_ACTIONS = Object.freeze([] as PermissionAction[]);

export const FAIL_CLOSED_POLICY: RolePolicy = Object.freeze({
  label: '权限策略未加载',
  domains: EMPTY_DOMAINS,
  actions: EMPTY_ACTIONS,
  scope: 'self',
});

export const ROLE_POLICIES = {
  general: {
    label: '总经理',
    domains: ['dashboard', 'sales', 'planning', 'manufacturing', 'warehouse', 'finance', 'integration'],
    actions: ['read', 'supervise'],
    scope: 'group',
  },
  sales: {
    label: '销售经理',
    domains: ['dashboard', 'sales', 'finance'],
    actions: ['read', 'create-intent', 'submit', 'audit', 'special-approve', 'change-order'],
    scope: 'organization',
  },
  planner: {
    label: '计划员',
    domains: ['dashboard', 'sales', 'planning', 'manufacturing'],
    actions: ['read', 'schedule', 'release-batch'],
    scope: 'organization',
  },
  production: {
    label: '生产主管',
    domains: ['dashboard', 'planning', 'manufacturing', 'warehouse'],
    actions: ['read', 'start-task', 'complete-task', 'scan-report', 'package'],
    scope: 'factory',
  },
  warehouse: {
    label: '仓库主管',
    domains: ['dashboard', 'manufacturing', 'warehouse', 'integration'],
    actions: ['read', 'stock-in', 'stock-out', 'transfer', 'retry-sync'],
    scope: 'warehouse',
  },
  finance: {
    label: '财务主管',
    domains: ['dashboard', 'sales', 'warehouse', 'finance'],
    actions: ['read', 'reconcile', 'allocate-cost', 'approve-cost'],
    scope: 'organization',
  },
  admin: {
    label: '系统管理员',
    domains: ['dashboard', 'sales', 'planning', 'manufacturing', 'warehouse', 'finance', 'integration', 'security'],
    actions: ['*'],
    scope: 'group',
  },
} as const satisfies Record<RoleKey, RolePolicy>;

export interface DataScopeContext {
  actorId: string;
  organizationId: string;
  factoryId?: string;
  warehouseId?: string;
}

export type RolePolicyOverrides = Partial<Record<RoleKey, RolePolicy>>;

const resolvePolicy = (role: RoleKey, overrides?: RolePolicyOverrides): RolePolicy =>
  overrides?.[role] ?? ROLE_POLICIES[role];

export const canAccess = (
  role: RoleKey,
  domain: DomainKey,
  action: PermissionAction = 'read',
  overrides?: RolePolicyOverrides,
): boolean => {
  const policy = resolvePolicy(role, overrides);
  return (
    policy.domains.includes(domain) &&
    (policy.actions.includes('*') || policy.actions.includes(action))
  );
};

export const visibleDomains = (role: RoleKey, overrides?: RolePolicyOverrides): DomainKey[] => [
  ...resolvePolicy(role, overrides).domains,
];

export function hasRequiredDataScopeContext(
  role: RoleKey,
  context: DataScopeContext,
  overrides?: RolePolicyOverrides,
): boolean {
  const scope = resolvePolicy(role, overrides).scope;
  const present = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  if (scope === 'group') return true;
  if (scope === 'organization') return present(context.organizationId);
  if (scope === 'factory') return present(context.factoryId);
  if (scope === 'warehouse') return present(context.warehouseId);
  return present(context.actorId);
}

export function filterByDataScope<T extends BusinessRecord>(
  role: RoleKey,
  records: T[],
  context: DataScopeContext,
  overrides?: RolePolicyOverrides,
): T[] {
  const scope = resolvePolicy(role, overrides).scope;
  if (!hasRequiredDataScopeContext(role, context, overrides)) return [];

  if (scope === 'group') return [...records];
  if (scope === 'organization') {
    return records.filter((row) => row.organizationId === context.organizationId);
  }
  if (scope === 'factory') return records.filter((row) => row.factoryId === context.factoryId);
  if (scope === 'warehouse') return records.filter((row) => row.warehouseId === context.warehouseId);
  return records.filter((row) => row.ownerId === context.actorId);
}
