import { Card, Switch, Table, Typography } from 'antd';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

interface MappingRow { source: string; target: string; rule: string; enabled: boolean }

const isMappingRow = (value: unknown): value is MappingRow => Boolean(
  value && typeof value === 'object' && typeof (value as MappingRow).source === 'string' &&
  typeof (value as MappingRow).target === 'string' && typeof (value as MappingRow).rule === 'string' &&
  typeof (value as MappingRow).enabled === 'boolean',
);

export function MappingPanel({ data }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const mappings = Array.isArray(data.mappings) ? data.mappings.filter(isMappingRow) : [];
  return (
    <section aria-label="数据映射" className={styles.panel}>
      <Card className={styles.queue} title="业务对象"><Typography.Text>{mappings.map((row) => row.source.split('.')[0]).join('、')}</Typography.Text></Card>
      <Card className={styles.workspace} title="字段映射">
        {mappings.length === 0 ? <Typography.Text type="secondary">暂无有效映射数据</Typography.Text> : null}
        <Table pagination={false} rowKey={(row) => `${row.source}-${row.target}`} dataSource={mappings} columns={[
          { dataIndex: 'source', title: '源对象' },
          { dataIndex: 'target', title: '目标对象' },
          { dataIndex: 'rule', title: '转换规则' },
        ]} />
      </Card>
      <Card className={styles.context} title="启用状态">
        {mappings.map((row) => <Switch aria-label={`${row.source}启用状态`} checked={row.enabled} disabled key={row.source} />)}
      </Card>
    </section>
  );
}
