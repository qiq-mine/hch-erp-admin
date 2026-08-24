import { tryResolvePage } from '../src/config/pageCatalog';
import { canAccess, type RolePolicy } from '../src/config/roles';
import type { RoleKey } from '../src/domain/types';

export interface ErpRoute {
  access?: string;
  component?: string;
  hideInMenu?: boolean;
  layout?: boolean;
  name?: string;
  path?: string;
  redirect?: string;
  routes?: ErpRoute[];
}

export function canEnterPath(pathname: string, role: RoleKey, policy?: RolePolicy): boolean {
  const page = tryResolvePage(pathname);
  if (!page) return false;
  const overrides = policy ? { [role]: policy } : undefined;
  if (!canAccess(role, page.domain, 'read', overrides)) return false;
  return page.path !== '/security/permissions' ||
    canAccess(role, 'security', 'permission-change', overrides);
}

const record = (path: string, name: string, access: string): ErpRoute => ({
  path, name, access, component: '@/pages/Records',
});
const workbench = (path: string, name: string, access: string): ErpRoute => ({
  path, name, access, component: '@/pages/Workbench',
});

const routes: ErpRoute[] = [
  { path: '/login', layout: false, component: '@/pages/Login' },
  { path: '/', redirect: '/dashboard' },
  { path: '/about', name: '系统介绍', hideInMenu: true, component: '@/pages/About' },
  { path: '/account/profile', name: '个人中心', hideInMenu: true, component: '@/pages/Profile' },
  { path: '/dashboard', name: '经营驾驶舱', access: 'dashboard', routes: [
    { path: '/dashboard', name: '经营总览', access: 'dashboard', component: '@/pages/Dashboard' },
    record('/dashboard/todos', '待办中心', 'dashboard'), record('/dashboard/alerts', '异常预警', 'dashboard'),
  ] },
  { path: '/sales', name: '销售与订单', access: 'sales', routes: [
    record('/sales/intents', '订购意向', 'sales'), record('/sales/orders', '销售订单', 'sales'),
    record('/sales/changes', '订单变更', 'sales'), record('/sales/credit', '信用特批', 'sales'),
  ] },
  { path: '/planning', name: '生产计划', access: 'planning', routes: [
    workbench('/planning/schedule', '排程工作台', 'planning'), workbench('/planning/batches', '合批投放', 'planning'),
    workbench('/planning/capacity', '产能日历', 'planning'),
  ] },
  { path: '/manufacturing', name: '制造执行', access: 'manufacturing', routes: [
    record('/manufacturing/tasks', '生产任务', 'manufacturing'),
    workbench('/manufacturing/reporting', '扫码报工', 'manufacturing'),
    workbench('/manufacturing/packaging', '包装齐套', 'manufacturing'),
  ] },
  { path: '/warehouse', name: '仓储物流', access: 'warehouse', routes: [
    workbench('/warehouse/inbound', '扫码入库', 'warehouse'), workbench('/warehouse/outbound', '扫码出库', 'warehouse'),
    workbench('/warehouse/transfers', '直接调拨', 'warehouse'),
  ] },
  { path: '/finance', name: '业财核算', access: 'finance', routes: [
    record('/finance/reconciliation', '对账核销', 'finance'), record('/finance/cost-collection', '成本归集', 'finance'),
    workbench('/finance/allocation', '分摊测算', 'finance'), workbench('/finance/analysis', '经营分析', 'finance'),
  ] },
  { path: '/integration', name: '系统集成', access: 'integration', routes: [
    workbench('/integration/monitor', '同步监控', 'integration'), record('/integration/tasks', '同步任务', 'integration'),
    workbench('/integration/mappings', '数据映射', 'integration'), record('/integration/audits', '集成审计', 'integration'),
  ] },
  { path: '/security', name: '系统与权限', access: 'security', routes: [
    record('/security/users', '用户管理', 'security'), record('/security/roles', '角色管理', 'security'),
    workbench('/security/permissions', '权限矩阵', 'permissionChange'), record('/security/audits', '授权审计', 'security'),
  ] },
  { path: '/403', layout: false, component: '@/pages/Exception/403' },
  { path: '*', layout: false, component: '@/pages/Exception/404' },
];

export default routes;
