import { Button, Card, Input, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

const statusText = (status: BusinessRecord['status']) => status === 'executing' ? '执行中' : '待投放';

export function BatchPanel({ busy, canPerform, data, onPerform }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = records.find((record) => record.id === selectedId);
  const [workshop, setWorkshop] = useState('');
  useEffect(() => {
    setWorkshop(String(selected?.data.workshop ?? ''));
  }, [selected]);
  return (
    <section aria-label="合批投放" className={styles.panel}>
      <Card className={styles.queue} title="合批队列">
        {records.map((record) => (
          <div key={record.id}>
            <Button block onClick={() => setSelectedId(record.id)} type={selectedId === record.id ? 'primary' : 'text'}>
              {record.number}
            </Button>
          </div>
        ))}
      </Card>
      <Card className={styles.workspace} title="批次明细">
        {selected ? (
          <Space orientation="vertical">
            <Typography.Title level={4}>{selected.title}</Typography.Title>
            <Typography.Text>{`订单数 ${String(selected.data.orderCount ?? 0)}`}</Typography.Text>
            <Tag color={selected.status === 'executing' ? 'processing' : 'default'}>{statusText(selected.status)}</Tag>
          </Space>
        ) : <Typography.Text type="secondary">请选择批次</Typography.Text>}
      </Card>
      <Card className={styles.context} title="产能与操作">
        {selected ? (
          <Space orientation="vertical">
            <Typography.Text>分组依据：材质 / 花色 / 厚度 / 交期</Typography.Text>
            <Input aria-label="人工调整车间" onChange={(event) => setWorkshop(event.target.value)} value={workshop} />
            <Typography.Text>{`产能占用 ${Math.round(Number(selected.data.capacityUsage ?? 0) * 100)}%`}</Typography.Text>
            {canPerform('release-batch') && selected.status !== 'executing' ? (
              <Button
                disabled={busy}
                loading={busy}
                onClick={() => void onPerform('release-batch', [selected.number], {
                  capacityUsage: selected.data.capacityUsage,
                  workshop,
                })}
                type="primary"
              >
                投放批次
              </Button>
            ) : null}
          </Space>
        ) : <Button onClick={() => setSelectedId(records.find((record) => Number(record.data.capacityUsage) <= 1)?.id)}>自动优化</Button>}
      </Card>
    </section>
  );
}
