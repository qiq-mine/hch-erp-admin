import { Button, Card, Progress, Space, Typography } from 'antd';
import { useState } from 'react';
import type { BusinessRecord } from '@/domain/types';
import { isPackageKittingData } from '@/domain/packageKitting';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

const isPackagingRecord = (value: unknown): value is BusinessRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as BusinessRecord;
  if (
    typeof record.id !== 'string' || typeof record.number !== 'string' ||
    typeof record.title !== 'string' || !record.data || typeof record.data !== 'object'
  ) return false;
  return isPackageKittingData(record.data);
};

export function PackagingPanel({ busy, canPerform, data, onPerform }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const records = Array.isArray(data.records) ? data.records.filter(isPackagingRecord) : [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = records.find((record) => record.id === selectedId);
  const rate = selected?.data.kittingRate as number | undefined ?? 0;
  return (
    <section aria-label="包装齐套" className={styles.panel}>
      <Card className={styles.queue} title="包装任务">
        {records.length === 0 ? <Typography.Text type="secondary">暂无有效包装任务</Typography.Text> : null}
        {records.map((record) => <div key={record.id}><Button block onClick={() => setSelectedId(record.id)} type="text">{record.number}</Button></div>)}
      </Card>
      <Card className={styles.workspace} title="齐套明细">
        {selected ? <Space orientation="vertical">
          <Typography.Title level={4}>{selected.title}</Typography.Title>
          <Progress percent={Math.round(rate * 100)} />
          <Typography.Text>{`齐套率 ${Math.round(rate * 100)}%`}</Typography.Text>
          <Typography.Text>{`已扫 ${String(selected.data.scannedQuantity ?? 0)} / 应扫 ${String(selected.data.requiredQuantity ?? 0)}`}</Typography.Text>
          {Array.isArray(selected.data.missingParts)
            ? selected.data.missingParts.filter((part): part is string => typeof part === 'string').map((part) => <Typography.Text key={part} type="danger">{`缺少：${part}`}</Typography.Text>)
            : null}
        </Space> : <Typography.Text type="secondary">请选择包装任务</Typography.Text>}
      </Card>
      <Card className={styles.context} title="包件操作">
        {canPerform('package') ? <Button disabled={!selected || busy || rate < 1} loading={busy} onClick={() => selected && void onPerform('package', [selected.number])} type="primary">生成包件</Button> : null}
        {selected?.status === 'completed' ? <Button disabled title="补打标签功能尚未接入">补打标签</Button> : null}
      </Card>
    </section>
  );
}
