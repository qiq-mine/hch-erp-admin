import { Button, Card, DatePicker, Input, Space, Statistic, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

export function SchedulePanel({ busy, canPerform, data, onPerform }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  const [selectedId, setSelectedId] = useState<string>();
  const [workshop, setWorkshop] = useState(String(data.workshop ?? ''));
  const [plannedDate, setPlannedDate] = useState('2026-08-26');
  const selected = records.find((record) => record.id === selectedId);
  useEffect(() => {
    if (!workshop && typeof data.workshop === 'string') setWorkshop(data.workshop);
  }, [data.workshop, workshop]);
  const assign = async () => {
    if (!selected) return;
    const result = await onPerform('schedule', [selected.number], { workshop, plannedDate });
    if (result?.success) setSelectedId(undefined);
  };
  return (
    <section aria-label="排程工作台" className={styles.panel}>
      <Card className={styles.queue} title="待排程订单">
        {records.map((record) => <div key={record.id}><Button block onClick={() => setSelectedId(record.id)} type="text">{record.number}</Button></div>)}
      </Card>
      <Card className={styles.workspace} title="交期与车间">
        {selected ? <Typography.Title level={4}>{selected.title}</Typography.Title> : null}
        <Space orientation="vertical">
          <Typography.Text>{`订单交期 ${String(selected?.data.deliveryDate ?? '-')}`}</Typography.Text>
          <Input aria-label="分配车间" onChange={(event) => setWorkshop(event.target.value)} value={workshop} />
          <DatePicker aria-label="计划日期" onChange={(value) => setPlannedDate(value?.format('YYYY-MM-DD') ?? '')} value={plannedDate ? dayjs(plannedDate) : null} />
        </Space>
      </Card>
      <Card className={styles.context} title="能力与操作">
        <Statistic title="日产能" value={Number(data.dailyCapacity ?? 0)} />
        {canPerform('schedule') ? <Button disabled={!selected || busy} loading={busy} onClick={() => void assign()} type="primary">确认排程</Button> : null}
      </Card>
    </section>
  );
}
