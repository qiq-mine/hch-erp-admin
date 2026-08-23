import { describe, expect, it } from 'vitest';
import access from '@/access';
import type { BusinessRecord, RoleKey } from '@/domain/types';
import {
  canAccess,
  FAIL_CLOSED_POLICY,
  filterByDataScope,
  ROLE_POLICIES,
  type RolePolicy,
  visibleDomains,
} from './roles';

const scopeContext = {
  actorId: 'u-1',
  organizationId: 'ORG-01',
  factoryId: 'F-01',
  warehouseId: 'WH-02',
};

function record(id: string, overrides: Partial<BusinessRecord>): BusinessRecord {
  return {
    id,
    number: `REC-${id}`,
    title: '演示单据',
    domain: 'warehouse',
    status: 'draft',
    organizationId: 'ORG-01',
    updatedAt: '2026-08-22T10:00:00.000Z',
    audit: [],
    data: {},
    ...overrides,
  };
}

describe('role policies', () => {
  it('defines the seven exact role labels, domains, actions, and data scopes', () => {
    const expected: Record<RoleKey, RolePolicy> = {
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
    };

    expect(ROLE_POLICIES).toEqual(expected);
    expect(Object.keys(ROLE_POLICIES)).toHaveLength(7);
  });

  it('allows a planner to release a batch but not manage permissions', () => {
    expect(canAccess('planner', 'planning', 'release-batch')).toBe(true);
    expect(canAccess('planner', 'security', 'permission-change')).toBe(false);
  });

  it('requires both a visible domain and an allowed action, while admin grants every action', () => {
    expect(canAccess('sales', 'sales', 'audit')).toBe(true);
    expect(canAccess('sales', 'sales', 'release-batch')).toBe(false);
    expect(canAccess('sales', 'planning', 'read')).toBe(false);
    expect(canAccess('admin', 'security', 'user-admin')).toBe(true);
  });

  it('returns a copy of visible domains and honors a per-role override', () => {
    const first = visibleDomains('planner');
    first.pop();
    expect(visibleDomains('planner')).toHaveLength(4);

    const override: RolePolicy = {
      label: '计划员（临时）',
      domains: ['dashboard', 'security'],
      actions: ['read', 'permission-change'],
      scope: 'self',
    };
    expect(canAccess('planner', 'security', 'permission-change', { planner: override })).toBe(true);
    expect(visibleDomains('planner', { planner: override })).toEqual(['dashboard', 'security']);
  });

  it('does not let an administrator wildcard action bypass a removed security domain', () => {
    const adminWithoutSecurity: RolePolicy = {
      ...ROLE_POLICIES.admin,
      domains: ['dashboard', 'sales', 'planning', 'manufacturing', 'warehouse', 'finance', 'integration'],
      actions: ['*'],
    };

    expect(canAccess('admin', 'security', 'user-admin', { admin: adminWithoutSecurity })).toBe(false);
    expect(canAccess('admin', 'planning', 'release-batch', { admin: adminWithoutSecurity })).toBe(true);
  });

  it('filters records according to every data scope without mutating group records', () => {
    const records = [
      record('group-match', { factoryId: 'F-01', warehouseId: 'WH-02', ownerId: 'u-1' }),
      record('organization-only', {
        factoryId: 'F-02',
        warehouseId: 'WH-03',
        ownerId: 'u-2',
      }),
      record('other-organization', {
        organizationId: 'ORG-02',
        factoryId: 'F-01',
        warehouseId: 'WH-02',
        ownerId: 'u-1',
      }),
    ];

    expect(filterByDataScope('general', records, scopeContext)).toEqual(records);
    expect(filterByDataScope('general', records, scopeContext)).not.toBe(records);
    expect(filterByDataScope('sales', records, scopeContext).map((item) => item.id)).toEqual([
      'group-match',
      'organization-only',
    ]);
    expect(filterByDataScope('production', records, scopeContext).map((item) => item.id)).toEqual([
      'group-match',
      'other-organization',
    ]);
    expect(filterByDataScope('warehouse', records, scopeContext).map((item) => item.id)).toEqual([
      'group-match',
      'other-organization',
    ]);
    expect(
      filterByDataScope('planner', records, scopeContext, {
        planner: { ...ROLE_POLICIES.planner, scope: 'self' },
      }).map((item) => item.id),
    ).toEqual(['group-match', 'other-organization']);
  });

  it('uses an override scope instead of the base warehouse scope without mutating records', () => {
    const records = [
      record('warehouse-match', { organizationId: 'ORG-01', warehouseId: 'WH-02' }),
      record('organization-match', { organizationId: 'ORG-01', warehouseId: 'WH-03' }),
      record('organization-miss', { organizationId: 'ORG-02', warehouseId: 'WH-02' }),
    ];
    const original = structuredClone(records);
    const organizationOverride: RolePolicy = {
      ...ROLE_POLICIES.warehouse,
      scope: 'organization',
    };

    expect(
      filterByDataScope('warehouse', records, scopeContext, {
        warehouse: organizationOverride,
      }).map((item) => item.id),
    ).toEqual(['warehouse-match', 'organization-match']);
    expect(records).toEqual(original);
  });

  it.each([
    ['factory', 'production', { actorId: 'u-1', organizationId: 'ORG-01' }],
    ['warehouse', 'warehouse', {
      actorId: 'u-1', organizationId: 'ORG-01', factoryId: 'F-01',
    }],
    ['self', 'planner', {
      actorId: undefined, organizationId: 'ORG-01', factoryId: 'F-01', warehouseId: 'WH-02',
    }],
  ] as const)('fails closed for %s scope when its runtime context dimension is missing', (
    scope,
    role,
    incomplete,
  ) => {
    const records = [record('dimensionless', {})];
    const overrides = scope === 'self'
      ? { planner: { ...ROLE_POLICIES.planner, scope: 'self' as const } }
      : undefined;

    expect(filterByDataScope(
      role,
      records,
      incomplete as typeof scopeContext,
      overrides,
    )).toEqual([]);
  });

  it('adapts the base policy to Umi access keys', () => {
    expect(access({
      activeRole: 'planner',
      currentPolicy: ROLE_POLICIES.planner,
      currentPrincipal: {
        actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
        access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
      },
    })).toMatchObject({
      dashboard: true,
      planning: true,
      security: false,
      permissionChange: false,
    });
  });

  it('fails closed before a verified policy is available', () => {
    expect(FAIL_CLOSED_POLICY).toMatchObject({
      domains: [],
      actions: [],
      scope: 'self',
    });
    expect(Object.isFrozen(FAIL_CLOSED_POLICY)).toBe(true);
    expect(Object.isFrozen(FAIL_CLOSED_POLICY.domains)).toBe(true);
    expect(Object.isFrozen(FAIL_CLOSED_POLICY.actions)).toBe(true);

    const denied = {
      dashboard: false,
      sales: false,
      planning: false,
      manufacturing: false,
      warehouse: false,
      finance: false,
      integration: false,
      security: false,
      permissionChange: false,
      resetDemo: false,
    };
    expect(access()).toEqual(denied);
    expect(access({
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
    })).toEqual(denied);
    expect(access({
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      initializationError: '权限策略加载失败',
    })).toEqual(denied);
    expect(access({ activeRole: 'admin' })).toEqual(denied);
  });
});
