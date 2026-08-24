import { Badge, Card, Statistic, Table, Typography } from 'antd';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

interface SystemHealth { name: string; healthy: boolean; throughput: number; failures: number }

const isSystemHealth = (value: unknown): value is SystemHealth => Boolean(
  value && typeof value === 'object' && typeof (value as SystemHealth).name === 'string' &&
  typeof (value as SystemHealth).healthy === 'boolean' &&
  typeof (value as SystemHealth).throughput === 'number' && Number.isFinite((value as SystemHealth).throughput) &&
  typeof (value as SystemHealth).failures === 'number' && Number.isInteger((value as SystemHealth).failures) &&
  (value as SystemHealth).failures >= 0,
);

export function IntegrationMonitorPanel({ data }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const systems = Array.isArray(data.systems) ? data.systems.filter(isSystemHealth) : [];
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  return (
    <section aria-label="同步监控" className={styles.panel}>
      <Card className={styles.queue} title="通道健康">
        {systems.length === 0 ? <Typography.Text type="secondary">暂无有效通道数据</Typography.Text> : null}
        {systems.map((system) => <div key={system.name}><Badge status={system.healthy ? 'success' : 'error'} text={system.healthy ? '运行正常' : '存在失败'} /></div>)}
      </Card>
      <Card className={styles.workspace} title="健康与吞吐">
        <Table pagination={false} rowKey="name" dataSource={systems} columns={[
          { dataIndex: 'name', title: '系统' },
          { dataIndex: 'throughput', title: '吞吐' },
          { dataIndex: 'failures', title: '失败数' },
        ]} />
      </Card>
      <Card className={styles.context} title="趋势与任务">
        <Statistic title="同步任务" value={records.length} />
        <Typography.Link href="/integration/tasks">查看失败任务与重试记录</Typography.Link>
      </Card>
    </section>
  );
}
