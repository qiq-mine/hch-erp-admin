import type {
  BillAction,
  DomainKey,
  PermissionAction,
} from '@/domain/types';
import type { RecordModule, WorkbenchModule } from '@/services/enterprise';

export type PageKind = 'dashboard' | 'records' | 'workbench';

export interface PageDefinition {
  path: string;
  domain: DomainKey;
  module: RecordModule | WorkbenchModule | 'overview';
  kind: PageKind;
  title: string;
  description: string;
  columns: readonly string[];
  actions: readonly (PermissionAction | BillAction)[];
}

const page = (
  path: string,
  domain: DomainKey,
  module: PageDefinition['module'],
  kind: PageKind,
  title: string,
  actions: PageDefinition['actions'] = ['read'],
): PageDefinition => ({
  path,
  domain,
  module,
  kind,
  title,
  description: `${title}业务视图`,
  columns: ['number', 'title', 'status', 'organizationId', 'updatedAt'],
  actions,
});

export const PAGE_CATALOG: readonly PageDefinition[] = [
  page('/dashboard', 'dashboard', 'overview', 'dashboard', '经营总览'),
  page('/dashboard/todos', 'dashboard', 'todos', 'records', '待办中心'),
  page('/dashboard/alerts', 'dashboard', 'alerts', 'records', '异常预警'),
  page('/sales/intents', 'sales', 'intent-orders', 'records', '订购意向', [
    'read',
    'create-intent',
    'submit',
    'audit',
    'push-order',
    'special-approve',
  ]),
  page('/sales/orders', 'sales', 'sales-orders', 'records', '销售订单'),
  page('/sales/changes', 'sales', 'order-changes', 'records', '订单变更', [
    'read',
    'change-order',
    'audit',
  ]),
  page('/sales/credit', 'sales', 'credit-approvals', 'records', '信用特批', [
    'read',
    'special-approve',
  ]),
  page('/planning/schedule', 'planning', 'schedule', 'workbench', '排程工作台', [
    'read',
    'schedule',
  ]),
  page('/planning/batches', 'planning', 'batches', 'workbench', '合批投放', [
    'read',
    'release-batch',
  ]),
  page('/planning/capacity', 'planning', 'capacity', 'workbench', '产能日历'),
  page(
    '/manufacturing/tasks',
    'manufacturing',
    'production-tasks',
    'records',
    '生产任务',
    ['read', 'start-task', 'complete-task'],
  ),
  page('/manufacturing/reporting', 'manufacturing', 'reporting', 'workbench', '扫码报工', [
    'read',
    'scan-report',
  ]),
  page('/manufacturing/packaging', 'manufacturing', 'packaging', 'workbench', '包装齐套', [
    'read',
    'package',
  ]),
  page('/warehouse/inbound', 'warehouse', 'stock', 'workbench', '扫码入库', [
    'read',
    'stock-in',
  ]),
  page('/warehouse/outbound', 'warehouse', 'stock', 'workbench', '扫码出库', [
    'read',
    'stock-out',
  ]),
  page('/warehouse/transfers', 'warehouse', 'stock', 'workbench', '直接调拨', [
    'read',
    'transfer',
  ]),
  page(
    '/finance/reconciliation',
    'finance',
    'reconciliations',
    'records',
    '对账核销',
    ['read', 'reconcile'],
  ),
  page(
    '/finance/cost-collection',
    'finance',
    'cost-collections',
    'records',
    '成本归集',
    ['read', 'approve-cost'],
  ),
  page('/finance/allocation', 'finance', 'allocation', 'workbench', '分摊测算', [
    'read',
    'allocate-cost',
    'approve-cost',
  ]),
  page('/finance/analysis', 'finance', 'analysis', 'workbench', '经营分析'),
  page(
    '/integration/monitor',
    'integration',
    'integration-monitor',
    'workbench',
    '同步监控',
  ),
  page('/integration/tasks', 'integration', 'sync-jobs', 'records', '同步任务', [
    'read',
    'retry-sync',
  ]),
  page(
    '/integration/mappings',
    'integration',
    'sync-mappings',
    'workbench',
    '数据映射',
  ),
  page('/integration/audits', 'integration', 'audits', 'records', '集成审计'),
  page('/security/users', 'security', 'users', 'records', '用户管理', [
    'read',
    'user-admin',
  ]),
  page('/security/roles', 'security', 'roles', 'records', '角色管理', [
    'read',
    'role-admin',
  ]),
  page('/security/permissions', 'security', 'permissions', 'workbench', '权限矩阵', [
    'read',
    'permission-change',
  ]),
  page('/security/audits', 'security', 'audits', 'records', '授权审计'),
];

export function resolvePage(pathname: string): PageDefinition {
  const definition = tryResolvePage(pathname);
  if (!definition) throw new Error(`Unknown ERP page: ${pathname}`);
  return definition;
}

export function tryResolvePage(pathname: string): PageDefinition | undefined {
  return PAGE_CATALOG.find((item) => item.path === pathname);
}
