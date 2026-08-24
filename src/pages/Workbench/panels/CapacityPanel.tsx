import { Card, Progress, Table, Tag, Typography } from 'antd';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

interface CapacityDay { date: string; workshop: string; usage: number }

const isCapacityDay = (value: unknown): value is CapacityDay => Boolean(
  value && typeof value === 'object' &&
  typeof (value as CapacityDay).date === 'string' &&
  typeof (value as CapacityDay).workshop === 'string' &&
  typeof (value as CapacityDay).usage === 'number' &&
  Number.isFinite((value as CapacityDay).usage),
);

export function CapacityPanel({ data }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const days = Array.isArray(data.days) ? data.days.filter(isCapacityDay) : [];
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  return (
    <section aria-label="产能日历" className={styles.panel}>
      <Card className={styles.queue} title="车间"><Typography.Text>{days.map((day) => day.workshop).join('、')}</Typography.Text></Card>
      <Card className={styles.workspace} title="日负荷">
        {days.length === 0 ? <Typography.Text type="secondary">暂无有效产能数据</Typography.Text> : null}
        <Table pagination={false} rowKey={(row) => `${row.date}-${row.workshop}`} dataSource={days} columns={[
          { dataIndex: 'date', title: '日期' },
          { dataIndex: 'workshop', title: '车间' },
          { title: '负荷', render: (_, row) => <Progress percent={Math.round(row.usage * 100)} status={row.usage > 1 ? 'exception' : 'normal'} /> },
        ]} />
      </Card>
      <Card className={styles.context} title="超载提示">
        {days.filter((day) => day.usage > 1).map((day) => <Tag color="error" key={day.date}>{`${day.workshop} ${Math.round(day.usage * 100)}%`}</Tag>)}
        <Typography.Paragraph>{`关联批次 ${records.length} 个`}</Typography.Paragraph>
      </Card>
    </section>
  );
}
