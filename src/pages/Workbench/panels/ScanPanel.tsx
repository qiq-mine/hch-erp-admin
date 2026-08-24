import { Button, Card, Input, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { BusinessRecord } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

export function ScanPanel({ busy, canPerform, data, onPerform }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const [barcode, setBarcode] = useState('');
  const successful = Array.isArray(data.successfulScans) ? data.successfulScans as BusinessRecord[] : [];
  useEffect(() => {
    document.querySelector<HTMLInputElement>('input[aria-label="扫描条码"]')?.focus();
  }, []);
  const submit = async () => {
    if (!barcode.trim()) return;
    const result = await onPerform('scan-report', [barcode], { barcode });
    if (result?.success) setBarcode('');
  };
  return (
    <section aria-label="扫码报工" className={styles.panel}>
      <Card className={styles.queue} title="成功记录">
        {successful.map((record) => <div data-testid="successful-scan" key={record.id}>{record.number}</div>)}
      </Card>
      <Card className={styles.workspace} title="工序扫码">
        <Space.Compact block>
          <Input
            aria-label="扫描条码"
            autoFocus
            disabled={busy}
            onChange={(event) => setBarcode(event.target.value)}
            onPressEnter={() => void submit()}
            value={barcode}
          />
          {canPerform('scan-report') ? <Button disabled={busy} loading={busy} onClick={() => void submit()} type="primary">报工</Button> : null}
        </Space.Compact>
      </Card>
      <Card className={styles.context} title="扫码说明">
        <Typography.Paragraph>条码范围、工序与重复状态由权威条码服务校验。</Typography.Paragraph>
      </Card>
    </section>
  );
}
