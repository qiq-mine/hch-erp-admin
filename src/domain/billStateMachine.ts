import type { Actor, AuditSourceModule, BillAction, BillStatus, BusinessRecord } from './types';

const transitions: Record<BillStatus, Partial<Record<BillAction, BillStatus>>> = {
  draft: { submit: 'submitted', cancel: 'cancelled' },
  submitted: { audit: 'audited', cancel: 'cancelled', 'special-approve': 'audited' },
  audited: { start: 'executing', cancel: 'cancelled' },
  executing: { complete: 'completed', cancel: 'cancelled' },
  completed: {},
  'validation-failed': { submit: 'submitted', cancel: 'cancelled' },
  'pending-special-approval': { 'special-approve': 'audited', cancel: 'cancelled' },
  'sync-failed': { 'retry-sync': 'executing', cancel: 'cancelled' },
  cancelled: {},
};

const labels: Record<BillStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  audited: '已审核',
  executing: '执行中',
  completed: '已完成',
  'validation-failed': '校验失败',
  'pending-special-approval': '待特批',
  'sync-failed': '同步失败',
  cancelled: '已取消',
};

const actionLabels: Record<BillAction, string> = {
  submit: '提交',
  audit: '审核',
  start: '开始执行',
  complete: '完成',
  'special-approve': '特批',
  'retry-sync': '同步重试',
  cancel: '取消',
};

export function transitionBill(
  record: BusinessRecord,
  action: BillAction,
  actor: Actor,
  now: string,
  sourceModule: AuditSourceModule = 'intent-orders',
): BusinessRecord {
  const status = transitions[record.status][action];
  if (!status) {
    throw new Error(`${labels[record.status]}状态不能执行${actionLabels[action]}`);
  }

  return {
    ...record,
    status,
    updatedAt: now,
    audit: [
      ...record.audit,
      {
        id: `${record.id}-${record.audit.length + 1}`,
        recordId: record.id,
        action,
        actor,
        occurredAt: now,
        result: 'success',
        message: `${actionLabels[action]}成功`,
        sourceModule,
      },
    ],
  };
}
