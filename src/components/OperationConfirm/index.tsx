import { Alert, Descriptions, Modal, Typography } from 'antd';
import type { BillAction, PermissionAction } from '@/domain/types';

export type OperationAction = BillAction | PermissionAction;

const ACTION_LABELS: Partial<Record<OperationAction, string>> = {
  submit: '提交',
  audit: '审核',
  'push-order': '生成订单',
  'special-approve': '特批放行',
  'retry-sync': '重试同步',
  'change-order': '发起变更',
  'start-task': '开工',
  'complete-task': '完工',
  reconcile: '核销',
  'approve-cost': '批准成本',
  'user-admin': '维护用户',
  'role-admin': '维护角色',
};

export const operationLabel = (action: OperationAction): string =>
  ACTION_LABELS[action] ?? action;

export interface OperationConfirmProps {
  action?: OperationAction;
  affectedCount: number;
  validationMessage?: string;
  open: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function OperationConfirm({
  action,
  affectedCount,
  validationMessage = '系统将在服务层再次校验权限、状态与数据范围。',
  open,
  loading = false,
  onCancel,
  onConfirm,
}: OperationConfirmProps) {
  const label = action ? operationLabel(action) : '业务';

  return (
    <Modal
      cancelButtonProps={{ disabled: loading }}
      cancelText="取消"
      closable={!loading}
      confirmLoading={loading}
      keyboard={!loading}
      mask={{ closable: !loading }}
      okText={`确认${label}`}
      onCancel={() => {
        if (!loading) onCancel();
      }}
      onOk={onConfirm}
      open={open}
      title={`${label}操作确认`}
    >
      <Descriptions
        column={1}
        items={[
          { key: 'action', label: '操作', children: label },
          { key: 'count', label: '影响范围', children: `${affectedCount} 条业务记录` },
        ]}
        size="small"
      />
      <Alert
        description={validationMessage}
        title="操作前校验"
        showIcon
        type="info"
      />
      <Typography.Paragraph type="secondary">
        确认后将记录操作人、角色、时间与执行结果。
      </Typography.Paragraph>
    </Modal>
  );
}
