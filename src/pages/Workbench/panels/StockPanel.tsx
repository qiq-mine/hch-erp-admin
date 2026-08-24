import { Button, Card, Input, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import type { BusinessRecord, PermissionAction } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

const MODES: Record<string, { action: PermissionAction; title: string; button: string }> = {
  '/warehouse/inbound': { action: 'stock-in', title: '扫码入库', button: '入库确认' },
  '/warehouse/outbound': { action: 'stock-out', title: '扫码出库', button: '出库确认' },
  '/warehouse/transfers': { action: 'transfer', title: '直接调拨', button: '确认调拨' },
};

export function StockPanel({ busy, canPerform, data, onPerform, page }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const mode = MODES[page.path];
  const records = Array.isArray(data.records) ? data.records as BusinessRecord[] : [];
  const [barcode, setBarcode] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [targetWarehouseId, setTargetWarehouseId] = useState('WH-01');
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const submit = async () => {
    const id = mode.action === 'transfer' ? selected?.number : barcode;
    if (!id) return;
    const result = await onPerform(mode.action, [id], mode.action === 'transfer'
      ? { targetWarehouseId }
      : { barcode });
    if (result?.success && mode.action !== 'transfer') setBarcode('');
  };
  return (
    <section aria-label={mode.title} className={styles.panel}>
      <Card className={styles.queue} title={mode.action === 'transfer' ? '调拨任务' : '库存任务'}>
        {records.map((record) => <div key={record.id}><Button block onClick={() => setSelectedId(record.id)} type="text">{record.number}</Button></div>)}
      </Card>
      <Card className={styles.workspace} title={mode.title}>
        {mode.action === 'transfer' ? (
          <Space orientation="vertical">
            <Typography.Text>{selected?.title ?? '暂无调拨任务'}</Typography.Text>
            <Typography.Text>{`来源仓库 ${selected?.warehouseId ?? '-'}`}</Typography.Text>
            <Select aria-label="目标仓库" onChange={setTargetWarehouseId} options={[{ value: 'WH-01', label: '一号仓' }, { value: 'WH-02', label: '二号仓' }]} value={targetWarehouseId} />
          </Space>
        ) : (
          <Input
            aria-label="扫描条码"
            autoFocus
            disabled={busy}
            onChange={(event) => setBarcode(event.target.value)}
            onPressEnter={() => void submit()}
            value={barcode}
          />
        )}
      </Card>
      <Card className={styles.context} title="校验与确认">
        <Typography.Paragraph>包件、齐套、出库状态和数据范围均由权威条码服务校验。</Typography.Paragraph>
        {canPerform(mode.action) ? <Button disabled={busy || (mode.action === 'transfer' ? !selected : !barcode.trim())} loading={busy} onClick={() => void submit()} type="primary">{mode.button}</Button> : null}
      </Card>
    </section>
  );
}
