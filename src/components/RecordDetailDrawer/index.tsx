import { Button, Descriptions, Drawer, Empty, Space, Table, Tabs, Typography } from 'antd';
import dayjs from 'dayjs';
import { BusinessTimeline } from '@/components/BusinessTimeline';
import {
  operationLabel,
  type OperationAction,
} from '@/components/OperationConfirm';
import type { BusinessRecord } from '@/domain/types';

const money = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
});

const DATA_LABELS: Record<string, string> = {
  customer: '客户',
  deliveryDate: '交付日期',
  sourceNumber: '来源单据',
  system: '目标系统',
  direction: '方向',
  batch: '批次',
  sourceObject: '来源对象',
  targetObject: '目标对象',
  errorCode: '错误码',
  errorSummary: '错误摘要',
  attempts: '尝试次数',
  lastResult: '最近结果',
  enabled: '启用状态',
  role: '角色',
  members: '成员数',
  responsibility: '职责',
};

function displayValue(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === 'string') return serialized;
    } catch {
      // Fall through to a stable human-readable representation.
    }
    try {
      return String(value);
    } catch {
      return '—';
    }
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    return value.includes('T')
      ? dayjs(value).format('YYYY-MM-DD HH:mm')
      : dayjs(value).format('YYYY-MM-DD');
  }
  return String(value);
}

function isPlainEntry(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scalarData(record: BusinessRecord) {
  return Object.entries(record.data).filter(([, value]) =>
    ['string', 'number', 'boolean'].includes(typeof value),
  );
}

export interface RecordDetailDrawerProps {
  record?: BusinessRecord;
  open: boolean;
  actions?: readonly OperationAction[];
  onClose: () => void;
  onAction?: (record: BusinessRecord, action: OperationAction) => void;
}

export function RecordDetailDrawer({
  record,
  open,
  actions = [],
  onClose,
  onAction,
}: RecordDetailDrawerProps) {
  if (!record) return null;

  const entries = Array.isArray(record.data.entries)
    ? record.data.entries.filter(isPlainEntry)
    : [];
  const entryColumns = [...new Set(entries.flatMap((entry) => Object.keys(entry)))];
  const integrationEvents = record.audit.filter((event) =>
    event.action === 'retry-sync' || event.action === 'push-order',
  );
  const tabs = [
    {
      key: 'basic',
      label: '基本信息',
      children: (
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            { key: 'number', label: '单据编号', children: record.number },
            { key: 'title', label: '业务摘要', children: record.title },
            { key: 'organization', label: '组织', children: record.organizationId },
            {
              key: 'updatedAt',
              label: '更新时间',
              children: dayjs(record.updatedAt).format('YYYY-MM-DD HH:mm'),
            },
            ...scalarData(record).map(([key, value]) => ({
              key,
              label: DATA_LABELS[key] ?? key,
              children: displayValue(value),
            })),
          ]}
          size="small"
        />
      ),
    },
    ...(entryColumns.length > 0
      ? [{
          key: 'entries',
          label: '分录信息',
          children: (
            <Table
              columns={entryColumns.map((key) => ({
                dataIndex: key,
                key,
                title: DATA_LABELS[key] ?? key,
                render: (value: unknown) => displayValue(value),
              }))}
              dataSource={entries.map((entry, index) => ({ ...entry, __key: index }))}
              pagination={false}
              rowKey="__key"
              size="small"
            />
          ),
        }]
      : []),
    ...(Number.isFinite(record.amount) || Number.isFinite(record.data.totalCents)
      ? [{
          key: 'funds',
          label: '资金与成本',
          children: (
            <Descriptions
              column={1}
              items={[
                ...(!Number.isFinite(record.amount)
                  ? []
                  : [{ key: 'amount', label: '单据金额', children: money.format(record.amount as number) }]),
                ...(!Number.isFinite(record.data.totalCents)
                  ? []
                  : [{
                      key: 'totalCents',
                      label: '成本金额',
                      children: money.format((record.data.totalCents as number) / 100),
                    }]),
              ]}
              size="small"
            />
          ),
        }]
      : []),
    {
      key: 'timeline',
      label: '业务时间线',
      children: <BusinessTimeline events={record.audit} />,
    },
    {
      key: 'integration',
      label: '集成日志',
      children: integrationEvents.length > 0
        ? <BusinessTimeline events={integrationEvents} />
        : <Empty description="暂无集成日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
    },
  ];

  return (
    <Drawer
      destroyOnHidden
      extra={(
        <Space wrap>
          {actions.map((action) => (
            <Button key={action} onClick={() => onAction?.(record, action)}>
              {operationLabel(action)}
            </Button>
          ))}
        </Space>
      )}
      onClose={onClose}
      open={open}
      title={(
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{record.number}</Typography.Text>
          <Typography.Text type="secondary">{record.title}</Typography.Text>
        </Space>
      )}
      size={720}
    >
      <Tabs items={tabs} />
    </Drawer>
  );
}
