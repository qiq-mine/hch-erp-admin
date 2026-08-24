import { describe, expect, it } from 'vitest';
import { ROLE_POLICIES } from '@/config/roles';
import routes, { canEnterPath } from './routes';

interface RouteLike {
  access?: string;
  path?: string;
  component?: string;
  hideInMenu?: boolean;
  routes?: RouteLike[];
}

const leaves = (items: RouteLike[]): RouteLike[] => items.flatMap((item) =>
  item.routes ? leaves(item.routes) : [item]);

const BUSINESS_PATHS = [
  '/dashboard', '/dashboard/todos', '/dashboard/alerts',
  '/sales/intents', '/sales/orders', '/sales/changes', '/sales/credit',
  '/planning/schedule', '/planning/batches', '/planning/capacity',
  '/manufacturing/tasks', '/manufacturing/reporting', '/manufacturing/packaging',
  '/warehouse/inbound', '/warehouse/outbound', '/warehouse/transfers',
  '/finance/reconciliation', '/finance/cost-collection', '/finance/allocation', '/finance/analysis',
  '/integration/monitor', '/integration/tasks', '/integration/mappings', '/integration/audits',
  '/security/users', '/security/roles', '/security/permissions', '/security/audits',
] as const;

const BUSINESS_LEAVES = [
  ['/dashboard', '@/pages/Dashboard', 'dashboard'],
  ['/dashboard/todos', '@/pages/Records', 'dashboard'], ['/dashboard/alerts', '@/pages/Records', 'dashboard'],
  ['/sales/intents', '@/pages/Records', 'sales'], ['/sales/orders', '@/pages/Records', 'sales'],
  ['/sales/changes', '@/pages/Records', 'sales'], ['/sales/credit', '@/pages/Records', 'sales'],
  ['/planning/schedule', '@/pages/Workbench', 'planning'], ['/planning/batches', '@/pages/Workbench', 'planning'],
  ['/planning/capacity', '@/pages/Workbench', 'planning'],
  ['/manufacturing/tasks', '@/pages/Records', 'manufacturing'],
  ['/manufacturing/reporting', '@/pages/Workbench', 'manufacturing'],
  ['/manufacturing/packaging', '@/pages/Workbench', 'manufacturing'],
  ['/warehouse/inbound', '@/pages/Workbench', 'warehouse'], ['/warehouse/outbound', '@/pages/Workbench', 'warehouse'],
  ['/warehouse/transfers', '@/pages/Workbench', 'warehouse'],
  ['/finance/reconciliation', '@/pages/Records', 'finance'], ['/finance/cost-collection', '@/pages/Records', 'finance'],
  ['/finance/allocation', '@/pages/Workbench', 'finance'], ['/finance/analysis', '@/pages/Workbench', 'finance'],
  ['/integration/monitor', '@/pages/Workbench', 'integration'], ['/integration/tasks', '@/pages/Records', 'integration'],
  ['/integration/mappings', '@/pages/Workbench', 'integration'], ['/integration/audits', '@/pages/Records', 'integration'],
  ['/security/users', '@/pages/Records', 'security'], ['/security/roles', '@/pages/Records', 'security'],
  ['/security/permissions', '@/pages/Workbench', 'permissionChange'], ['/security/audits', '@/pages/Records', 'security'],
] as const;

describe('complete route tree', () => {
  it('wires the exact 28 business paths plus login, 403, and 404', () => {
    const routeLeaves = leaves(routes as RouteLike[]);
    const business = routeLeaves.filter((route) => BUSINESS_PATHS.includes(route.path as never));
    expect(business.map((route) => route.path)).toEqual(BUSINESS_PATHS);
    expect(new Set(business.map((route) => route.path)).size).toBe(28);
    expect(routeLeaves).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/login', component: '@/pages/Login' }),
      expect.objectContaining({ path: '/about', component: '@/pages/About', hideInMenu: true }),
      expect.objectContaining({ path: '/account/profile', component: '@/pages/Profile', hideInMenu: true }),
      expect.objectContaining({ path: '/403', component: '@/pages/Exception/403' }),
      expect.objectContaining({ path: '*', component: '@/pages/Exception/404' }),
    ]));
  });

  it('maps every business leaf to its catalog page kind', () => {
    const business = leaves(routes as RouteLike[])
      .filter((route) => BUSINESS_PATHS.includes(route.path as never));
    expect(business.filter((route) => route.component === '@/pages/Dashboard')).toHaveLength(1);
    expect(business.filter((route) => route.component === '@/pages/Records')).toHaveLength(14);
    expect(business.filter((route) => route.component === '@/pages/Workbench')).toHaveLength(13);
  });

  it('matches the complete exact path, component, and access leaf contract', () => {
    const parents = (routes as RouteLike[]).filter((route) => route.routes);
    expect(parents.map((route) => route.path)).toEqual([
      '/dashboard', '/sales', '/planning', '/manufacturing',
      '/warehouse', '/finance', '/integration', '/security',
    ]);
    expect(parents.flatMap((route) => route.routes ?? [])
      .map(({ path, component, access }) => [path, component, access]))
      .toEqual(BUSINESS_LEAVES);
  });
});

describe('route access boundary', () => {
  it('uses the current dynamic policy and permission action', () => {
    expect(canEnterPath('/planning/batches', 'planner')).toBe(true);
    expect(canEnterPath('/security/permissions', 'planner')).toBe(false);
    expect(canEnterPath('/integration/tasks', 'admin', {
      ...ROLE_POLICIES.admin,
      domains: ['dashboard'],
      actions: ['read'],
    })).toBe(false);
    expect(canEnterPath('/security/permissions', 'admin', {
      ...ROLE_POLICIES.admin,
      actions: ['read'],
    })).toBe(false);
  });

  it.each(['/unknown', '/planning/batches/', '/planning/batches?x=1', '', '/login'])
  ('fails closed for a non-exact business path: %s', (pathname) => {
    expect(canEnterPath(pathname, 'admin')).toBe(false);
  });
});
