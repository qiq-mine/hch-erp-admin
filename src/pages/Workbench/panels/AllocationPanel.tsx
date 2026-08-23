import { Button, Card, InputNumber, Space, Table, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

interface WeightRow { id: string; weight: number }
interface PreviewRow extends WeightRow { amountCents: number }

export function yuanInputToCents(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ''] = normalized.split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(`${fraction}00`.slice(0, 2));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export function AllocationPanel({ busy, canPerform, data, onPerform }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  const source = records[0];
  const weights = Array.isArray(data.weights) ? data.weights as WeightRow[] : [];
  const preview = Array.isArray(data.preview) ? data.preview as PreviewRow[] : [];
  const initialCents = Number(source?.data.totalCents ?? source?.amount ?? 0);
  const [amountText, setAmountText] = useState((initialCents / 100).toFixed(2));
  const totalCents = yuanInputToCents(amountText);
  const previewTotal = preview.reduce((sum, row) => sum + row.amountCents, 0);
  const tailCents = useMemo(() => {
    if (totalCents === undefined || weights.length === 0) return 0;
    const totalWeight = weights.reduce((sum, row) => sum + row.weight, 0);
    const floorTotal = weights.reduce((sum, row) => sum + Math.floor((totalCents * row.weight) / totalWeight), 0);
    return totalCents - floorTotal;
  }, [totalCents, weights]);
  const trial = () => source && totalCents !== undefined
    ? onPerform('allocate-cost', [source.number], { totalCents, weights })
    : undefined;
  return (
    <section aria-label="分摊测算" className={styles.panel}>
      <Card className={styles.queue} title="成本来源">
        <Typography.Text>{source?.number ?? '暂无成本归集'}</Typography.Text>
      </Card>
      <Card className={styles.workspace} title="物理权重试算">
        <Space orientation="vertical" style={{ width: '100%' }}>
          <InputNumber
            aria-label="待分摊金额"
            min="0"
            onChange={(value) => setAmountText(value === null ? '' : String(value))}
            precision={2}
            status={totalCents === undefined ? 'error' : undefined}
            stringMode
            value={amountText}
          />
          <Typography.Text>公式：整数分 = 总金额分 × 权重 ÷ 总权重，最大余数法补齐尾差</Typography.Text>
          <Table pagination={false} rowKey="id" dataSource={preview} columns={[
            { dataIndex: 'id', title: '分摊对象' },
            { dataIndex: 'weight', title: '权重' },
            { title: '金额', render: (_, row) => yuan(row.amountCents) },
          ]} />
          {preview.length ? <Typography.Text>{`分摊合计 ${yuan(previewTotal)}`}</Typography.Text> : null}
          {preview.length && tailCents ? <Typography.Text>{`尾差调整 ${(tailCents / 100).toFixed(2)} 元`}</Typography.Text> : null}
        </Space>
      </Card>
      <Card className={styles.context} title="操作">
        {canPerform('allocate-cost') ? <Button aria-label="试算" disabled={busy || !source || totalCents === undefined} loading={busy} onClick={() => void trial()} type="primary">试算</Button> : null}
        {canPerform('approve-cost') && preview.length ? <Button disabled={busy} onClick={() => source && void onPerform('approve-cost', [source.number])}>审批分摊</Button> : null}
      </Card>
    </section>
  );
}
