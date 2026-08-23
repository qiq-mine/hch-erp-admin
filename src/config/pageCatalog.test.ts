import { describe, expect, it } from 'vitest';
import { PAGE_CATALOG, resolvePage, tryResolvePage } from './pageCatalog';

const EXPECTED_PAGES = [
  ['/dashboard', 'dashboard', 'overview', 'dashboard', '经营总览', ['read']],
  ['/dashboard/todos', 'dashboard', 'todos', 'records', '待办中心', ['read']],
  ['/dashboard/alerts', 'dashboard', 'alerts', 'records', '异常预警', ['read']],
  ['/sales/intents', 'sales', 'intent-orders', 'records', '订购意向', ['read', 'create-intent', 'submit', 'audit', 'push-order', 'special-approve']],
  ['/sales/orders', 'sales', 'sales-orders', 'records', '销售订单', ['read']],
  ['/sales/changes', 'sales', 'order-changes', 'records', '订单变更', ['read', 'change-order', 'audit']],
  ['/sales/credit', 'sales', 'credit-approvals', 'records', '信用特批', ['read', 'special-approve']],
  ['/planning/schedule', 'planning', 'schedule', 'workbench', '排程工作台', ['read', 'schedule']],
  ['/planning/batches', 'planning', 'batches', 'workbench', '合批投放', ['read', 'release-batch']],
  ['/planning/capacity', 'planning', 'capacity', 'workbench', '产能日历', ['read']],
  ['/manufacturing/tasks', 'manufacturing', 'production-tasks', 'records', '生产任务', ['read', 'start-task', 'complete-task']],
  ['/manufacturing/reporting', 'manufacturing', 'reporting', 'workbench', '扫码报工', ['read', 'scan-report']],
  ['/manufacturing/packaging', 'manufacturing', 'packaging', 'workbench', '包装齐套', ['read', 'package']],
  ['/warehouse/inbound', 'warehouse', 'stock', 'workbench', '扫码入库', ['read', 'stock-in']],
  ['/warehouse/outbound', 'warehouse', 'stock', 'workbench', '扫码出库', ['read', 'stock-out']],
  ['/warehouse/transfers', 'warehouse', 'stock', 'workbench', '直接调拨', ['read', 'transfer']],
  ['/finance/reconciliation', 'finance', 'reconciliations', 'records', '对账核销', ['read', 'reconcile']],
  ['/finance/cost-collection', 'finance', 'cost-collections', 'records', '成本归集', ['read', 'approve-cost']],
  ['/finance/allocation', 'finance', 'allocation', 'workbench', '分摊测算', ['read', 'allocate-cost', 'approve-cost']],
  ['/finance/analysis', 'finance', 'analysis', 'workbench', '经营分析', ['read']],
  ['/integration/monitor', 'integration', 'integration-monitor', 'workbench', '同步监控', ['read']],
  ['/integration/tasks', 'integration', 'sync-jobs', 'records', '同步任务', ['read', 'retry-sync']],
  ['/integration/mappings', 'integration', 'sync-mappings', 'workbench', '数据映射', ['read']],
  ['/integration/audits', 'integration', 'audits', 'records', '集成审计', ['read']],
  ['/security/users', 'security', 'users', 'records', '用户管理', ['read', 'user-admin']],
  ['/security/roles', 'security', 'roles', 'records', '角色管理', ['read', 'role-admin']],
  ['/security/permissions', 'security', 'permissions', 'workbench', '权限矩阵', ['read', 'permission-change']],
  ['/security/audits', 'security', 'audits', 'records', '授权审计', ['read']],
] as const;

describe('page catalog', () => {
  it('defines every unique route with its exact domain, module, kind, title, and actions', () => {
    expect(PAGE_CATALOG.map(({ path, domain, module, kind, title, actions }) => [
      path,
      domain,
      module,
      kind,
      title,
      actions,
    ])).toEqual(EXPECTED_PAGES);
    expect(new Set(PAGE_CATALOG.map(({ path }) => path)).size).toBe(PAGE_CATALOG.length);
  });

  it('supplies a description and useful standard columns for every page', () => {
    for (const definition of PAGE_CATALOG) {
      expect(definition.description).toBe(`${definition.title}业务视图`);
      expect(definition.columns).toEqual([
        'number',
        'title',
        'status',
        'organizationId',
        'updatedAt',
      ]);
    }
  });

  it('resolves the required representative pages', () => {
    expect(resolvePage('/sales/intents')).toMatchObject({
      module: 'intent-orders',
      kind: 'records',
      title: '订购意向',
    });
    expect(resolvePage('/integration/tasks')).toMatchObject({
      module: 'sync-jobs',
      kind: 'records',
      title: '同步任务',
    });
    expect(resolvePage('/finance/allocation')).toMatchObject({
      module: 'allocation',
      kind: 'workbench',
      title: '分摊测算',
    });
    expect(resolvePage('/security/permissions')).toMatchObject({
      module: 'permissions',
      kind: 'workbench',
      title: '权限矩阵',
    });
  });

  it.each([
    '/sales/intents/',
    '/sales/intents?status=submitted',
    '/sales/intents#detail',
    '/missing',
  ])('rejects non-exact or unknown pathname %s', (pathname) => {
    expect(() => resolvePage(pathname)).toThrow(`Unknown ERP page: ${pathname}`);
    expect(tryResolvePage(pathname)).toBeUndefined();
  });

  it('provides a non-throwing exact resolver for route guards', () => {
    expect(tryResolvePage('/integration/tasks')).toMatchObject({ module: 'sync-jobs' });
  });
});
