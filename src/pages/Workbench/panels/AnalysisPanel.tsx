import { Card, Statistic, Table, Typography } from 'antd';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

interface ProfitRow { customer: string; revenue: number; profitRate: number }
interface VarianceRow { item: string; budget: number; actual: number }
interface MaterialRow { material: string; standard: number; actual: number }

const isProfitRow = (value: unknown): value is ProfitRow => Boolean(
  value && typeof value === 'object' && typeof (value as ProfitRow).customer === 'string' &&
  typeof (value as ProfitRow).revenue === 'number' && Number.isFinite((value as ProfitRow).revenue) &&
  typeof (value as ProfitRow).profitRate === 'number' && Number.isFinite((value as ProfitRow).profitRate),
);
const isVarianceRow = (value: unknown): value is VarianceRow => Boolean(
  value && typeof value === 'object' && typeof (value as VarianceRow).item === 'string' &&
  typeof (value as VarianceRow).budget === 'number' && Number.isFinite((value as VarianceRow).budget) &&
  typeof (value as VarianceRow).actual === 'number' && Number.isFinite((value as VarianceRow).actual),
);
const isMaterialRow = (value: unknown): value is MaterialRow => Boolean(
  value && typeof value === 'object' && typeof (value as MaterialRow).material === 'string' &&
  typeof (value as MaterialRow).standard === 'number' && Number.isFinite((value as MaterialRow).standard) &&
  typeof (value as MaterialRow).actual === 'number' && Number.isFinite((value as MaterialRow).actual),
);

export function AnalysisPanel({ data }: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const profits = Array.isArray(data.customerProfit) ? data.customerProfit.filter(isProfitRow) : [];
  const variances = Array.isArray(data.expenseVariance) ? data.expenseVariance.filter(isVarianceRow) : [];
  const materials = Array.isArray(data.materialCostComparison) ? data.materialCostComparison.filter(isMaterialRow) : [];
  return (
    <section aria-label="经营分析" className={styles.panel}>
      <Card className={styles.queue} title="分析主题"><Typography.Text>客户盈利</Typography.Text><br /><Typography.Text>费用损益</Typography.Text><br /><Typography.Text>材料成本对比</Typography.Text></Card>
      <Card className={styles.workspace} title="客户盈利">
        {profits.length === 0 ? <Typography.Text type="secondary">暂无有效客户盈利数据</Typography.Text> : null}
        <Table pagination={false} rowKey="customer" dataSource={profits} columns={[
          { dataIndex: 'customer', title: '客户' },
          { dataIndex: 'revenue', title: '收入', render: (value) => `¥${(Number(value) / 100).toFixed(2)}` },
          { dataIndex: 'profitRate', title: '毛利率', render: (value) => `${Math.round(Number(value) * 100)}%` },
        ]} />
      </Card>
      <Card className={styles.context} title="费用偏差">
        {variances.map((row) => <Statistic key={row.item} title={row.item} value={row.actual - row.budget} prefix="¥" />)}
        <Typography.Title level={5}>材料成本对比</Typography.Title>
        {materials.length ? materials.map((row) => <Typography.Paragraph key={row.material}>{`${row.material} 标准 ${row.standard} / 实际 ${row.actual}`}</Typography.Paragraph>) : <Typography.Paragraph type="secondary">暂无材料成本对比数据</Typography.Paragraph>}
        <Typography.Link href="/finance/cost-collection">查看来源成本归集</Typography.Link>
      </Card>
    </section>
  );
}
