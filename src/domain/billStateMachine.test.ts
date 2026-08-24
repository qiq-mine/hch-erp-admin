import { describe, expect, it } from 'vitest';
import { transitionBill } from './billStateMachine';
import type { Actor, AuditEvent, BillAction, BillStatus, BusinessRecord } from './types';

const actor: Actor = { userId: 'u-admin', name: '系统管理员', role: 'admin' };
const now = '2026-08-22T10:01:00.000Z';

function seedAudit(recordId: string): AuditEvent {
  return {
    id: `${recordId}-1`,
    recordId,
    action: 'role-switch',
    actor,
    occurredAt: '2026-08-22T10:00:00.000Z',
    result: 'success',
    message: '角色切换成功',
    sourceModule: 'users',
  };
}

function makeRecord(status: BillStatus, id: string): BusinessRecord {
  return {
    id,
    number: `${id.toUpperCase()}-001`,
    title: '订购意向',
    domain: 'sales',
    status,
    organizationId: 'org-east',
    factoryId: 'factory-east',
    warehouseId: 'warehouse-east',
    ownerId: 'u-owner',
    amount: 12800,
    updatedAt: '2026-08-22T10:00:00.000Z',
    audit: [seedAudit(id)],
    data: { source: 'demo', lines: [{ sku: 'SKU-001', quantity: 2 }] },
  };
}

const sourceRecords: Record<BillStatus, BusinessRecord> = {
  draft: makeRecord('draft', 'bill-draft'),
  submitted: makeRecord('submitted', 'bill-submitted'),
  audited: makeRecord('audited', 'bill-audited'),
  executing: makeRecord('executing', 'bill-executing'),
  completed: makeRecord('completed', 'bill-completed'),
  'validation-failed': makeRecord('validation-failed', 'bill-validation-failed'),
  'pending-special-approval': makeRecord('pending-special-approval', 'bill-pending-special-approval'),
  'sync-failed': makeRecord('sync-failed', 'bill-sync-failed'),
  cancelled: makeRecord('cancelled', 'bill-cancelled'),
};

const legalTransitions: Array<{
  from: BillStatus;
  action: BillAction;
  to: BillStatus;
  message: string;
}> = [
  { from: 'draft', action: 'submit', to: 'submitted', message: '提交成功' },
  { from: 'draft', action: 'cancel', to: 'cancelled', message: '取消成功' },
  { from: 'submitted', action: 'audit', to: 'audited', message: '审核成功' },
  { from: 'submitted', action: 'cancel', to: 'cancelled', message: '取消成功' },
  { from: 'submitted', action: 'special-approve', to: 'audited', message: '特批成功' },
  { from: 'audited', action: 'start', to: 'executing', message: '开始执行成功' },
  { from: 'audited', action: 'cancel', to: 'cancelled', message: '取消成功' },
  { from: 'executing', action: 'complete', to: 'completed', message: '完成成功' },
  { from: 'executing', action: 'cancel', to: 'cancelled', message: '取消成功' },
  { from: 'validation-failed', action: 'submit', to: 'submitted', message: '提交成功' },
  { from: 'validation-failed', action: 'cancel', to: 'cancelled', message: '取消成功' },
  {
    from: 'pending-special-approval',
    action: 'special-approve',
    to: 'audited',
    message: '特批成功',
  },
  { from: 'pending-special-approval', action: 'cancel', to: 'cancelled', message: '取消成功' },
  { from: 'sync-failed', action: 'retry-sync', to: 'executing', message: '同步重试成功' },
  { from: 'sync-failed', action: 'cancel', to: 'cancelled', message: '取消成功' },
];

describe('transitionBill', () => {
  it.each(legalTransitions)(
    'transitions $from via $action to $to and appends an exact audit event',
    ({ from, action, to, message }) => {
      const source = structuredClone(sourceRecords[from]);
      const original = structuredClone(source);
      const next = transitionBill(source, action, actor, now);
      const event = next.audit.at(-1);

      expect(next.status).toBe(to);
      expect(next.updatedAt).toBe(now);
      expect(next.audit).toHaveLength(source.audit.length + 1);
      expect(next.audit.slice(0, -1)).toEqual(source.audit);
      expect(next.audit).not.toBe(source.audit);
      expect(event).toBeDefined();
      expect(event?.id).toBe(`${source.id}-${source.audit.length + 1}`);
      expect(event?.recordId).toBe(source.id);
      expect(event?.action).toBe(action);
      expect(event?.actor).toEqual(actor);
      expect(event?.occurredAt).toBe(now);
      expect(event?.result).toBe('success');
      expect(event?.message).toBe(message);
      expect(next.data).toEqual(source.data);
      expect(next.data).toBe(source.data);
      expect(source).toEqual(original);
      expect(source.audit).toEqual(original.audit);
    },
  );

  it('rejects completion from draft without changing the source record or audit', () => {
    const source = structuredClone(sourceRecords.draft);
    const original = structuredClone(source);

    expect(() => transitionBill(source, 'complete', actor, now)).toThrowError('草稿状态不能执行完成');
    expect(source).toEqual(original);
    expect(source.audit).toEqual(original.audit);
  });
});
