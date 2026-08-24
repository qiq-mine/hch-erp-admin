export type RoleKey =
  | 'general'
  | 'sales'
  | 'planner'
  | 'production'
  | 'warehouse'
  | 'finance'
  | 'admin';

export type DomainKey =
  | 'dashboard'
  | 'sales'
  | 'planning'
  | 'manufacturing'
  | 'warehouse'
  | 'finance'
  | 'integration'
  | 'security';

export type DataScope = 'group' | 'organization' | 'factory' | 'warehouse' | 'self';

export type BillStatus =
  | 'draft'
  | 'submitted'
  | 'audited'
  | 'executing'
  | 'completed'
  | 'validation-failed'
  | 'pending-special-approval'
  | 'sync-failed'
  | 'cancelled';

export type BillAction =
  | 'submit'
  | 'audit'
  | 'start'
  | 'complete'
  | 'special-approve'
  | 'retry-sync'
  | 'cancel';

export type PermissionAction =
  | 'read'
  | 'supervise'
  | 'create-intent'
  | 'submit'
  | 'audit'
  | 'push-order'
  | 'special-approve'
  | 'change-order'
  | 'schedule'
  | 'release-batch'
  | 'start-task'
  | 'complete-task'
  | 'scan-report'
  | 'package'
  | 'stock-in'
  | 'stock-out'
  | 'transfer'
  | 'retry-sync'
  | 'reconcile'
  | 'allocate-cost'
  | 'approve-cost'
  | 'permission-change'
  | 'user-admin'
  | 'role-admin'
  | 'reset-demo';

export interface Actor {
  userId: string;
  name: string;
  role: RoleKey;
}

export type AuditSourceModule =
  | 'intent-orders' | 'sales-orders' | 'order-changes' | 'credit-approvals'
  | 'production-tasks' | 'inbound' | 'outbound' | 'transfers'
  | 'reconciliations' | 'cost-collections' | 'sync-jobs' | 'users' | 'roles'
  | 'batches' | 'reporting' | 'packaging';

export interface AuditEvent {
  id: string;
  recordId: string;
  action: BillAction | PermissionAction | 'role-switch';
  actor: Actor;
  occurredAt: string;
  result: 'success' | 'failed';
  message: string;
  sourceModule: AuditSourceModule;
}

export interface BusinessRecord {
  id: string;
  number: string;
  title: string;
  domain: DomainKey;
  status: BillStatus;
  organizationId: string;
  factoryId?: string;
  warehouseId?: string;
  ownerId?: string;
  amount?: number;
  updatedAt: string;
  audit: AuditEvent[];
  data: Record<string, unknown>;
}

export interface OperationResult {
  success: boolean;
  message: string;
  affectedIds: string[];
  events: AuditEvent[];
}
