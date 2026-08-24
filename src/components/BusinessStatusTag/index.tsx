import { Tag } from 'antd';
import type { BillStatus } from '@/domain/types';

const STATUS_PRESENTATION: Record<BillStatus, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  submitted: { color: 'processing', label: '已提交' },
  audited: { color: 'cyan', label: '已审核' },
  executing: { color: 'blue', label: '执行中' },
  completed: { color: 'success', label: '已完成' },
  'validation-failed': { color: 'error', label: '校验失败' },
  'pending-special-approval': { color: 'warning', label: '待特批' },
  'sync-failed': { color: 'error', label: '同步失败' },
  cancelled: { color: 'default', label: '已取消' },
};

export function BusinessStatusTag({ status }: { status: BillStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  return <Tag color={presentation.color}>{presentation.label}</Tag>;
}
