import type { DataScopeContext, RolePolicy, RolePolicyOverrides } from '@/config/roles';
import type {
  Actor,
  AuditEvent,
  BillAction,
  BusinessRecord,
  OperationResult,
  PermissionAction,
  RoleKey,
  DataScope,
} from '@/domain/types';

export type RecordModule =
  | 'todos'
  | 'alerts'
  | 'intent-orders'
  | 'sales-orders'
  | 'order-changes'
  | 'credit-approvals'
  | 'production-tasks'
  | 'inbound'
  | 'outbound'
  | 'transfers'
  | 'reconciliations'
  | 'cost-collections'
  | 'sync-jobs'
  | 'users'
  | 'roles'
  | 'audits';

export type WorkbenchModule =
  | 'schedule'
  | 'batches'
  | 'capacity'
  | 'reporting'
  | 'packaging'
  | 'stock'
  | 'allocation'
  | 'analysis'
  | 'integration-monitor'
  | 'sync-mappings'
  | 'permissions';

export interface AccessContext extends DataScopeContext {
  role: RoleKey;
}

export interface RolePrincipal {
  actor: Actor;
  access: AccessContext;
}

export interface ListQuery {
  keyword?: string;
  status?: string;
  organizationId?: string;
  page?: number;
  pageSize?: number;
  access?: AccessContext;
  auditCategory?: 'integration' | 'security';
  auditOrder?: 'latest';
  auditActor?: string;
  auditAction?: string;
  auditResult?: 'success' | 'failed';
  auditDate?: string;
}

export interface ListResult<T> {
  data: T[];
  total: number;
  success: true;
}

export interface DashboardData {
  metrics: { key: string; label: string; value: number; unit: string; delta: number }[];
  trend: { date: string; orders: number; delivered: number }[];
  todos: BusinessRecord[];
  alerts: BusinessRecord[];
}

export interface PerformCommand {
  module: RecordModule | WorkbenchModule;
  action: BillAction | PermissionAction;
  ids: string[];
  actor: Actor;
  access?: AccessContext;
  payload?: Record<string, unknown>;
}

export interface EnterpriseRepository {
  listRecords(module: RecordModule, query?: ListQuery): Promise<ListResult<BusinessRecord>>;
  getDashboard(role: RoleKey): Promise<DashboardData>;
  getWorkbench(
    module: WorkbenchModule,
    access?: AccessContext,
  ): Promise<Record<string, unknown>>;
  getRolePolicy(role: RoleKey): Promise<RolePolicy>;
  getRolePrincipal(role: RoleKey): Promise<RolePrincipal | undefined>;
  getAssignableScopes(role: RoleKey): Promise<DataScope[]>;
  perform(command: PerformCommand): Promise<OperationResult>;
  listAuditEvents(): Promise<AuditEvent[]>;
  reset(actor: Actor): Promise<OperationResult>;
}

export interface MockDatabase {
  records: Record<RecordModule, BusinessRecord[]>;
  workbenches: Record<WorkbenchModule, Record<string, unknown>>;
  roleOverrides: RolePolicyOverrides;
  auditEvents: AuditEvent[];
}
