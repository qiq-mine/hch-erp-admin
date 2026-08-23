import { Line } from '@ant-design/plots';
import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components';
import { useModel, useRequest } from '@umijs/max';
import { Button, List, Result, Skeleton, Space, Steps, Typography } from 'antd';
import dayjs from 'dayjs';
import type { AppInitialState } from '@/app';
import { BusinessStatusTag } from '@/components/BusinessStatusTag';
import { BusinessTimeline } from '@/components/BusinessTimeline';
import type { BusinessRecord, RoleKey } from '@/domain/types';
import {
  enterpriseRepository,
  type DashboardData,
  type EnterpriseRepository,
} from '@/services/enterprise';
import { useDashboardStyles } from './styles';

const PROCESS_LABELS = [
  '订购意向',
  '信用审核',
  '排程合批',
  '生产报工',
  '包装齐套',
  '入库发运',
  '核销分摊',
  '经营分析',
] as const;

const PROCESS_STEPS = PROCESS_LABELS.map((title) => ({ title }));

export interface DashboardProps {
  repository?: EnterpriseRepository;
  activeRole: RoleKey;
  refreshToken?: number;
}

interface DashboardLoadResult {
  data?: DashboardData;
  error?: Error;
}

function RecordItem({ record }: { record: BusinessRecord }) {
  const { styles } = useDashboardStyles();
  return (
    <List.Item>
      <List.Item.Meta
        title={
          <div className={styles.recordMeta}>
            <Typography.Text strong>{record.number}</Typography.Text>
            <Typography.Text>{record.title}</Typography.Text>
            <BusinessStatusTag status={record.status} />
          </div>
        }
        description={
          <>
            <Typography.Text type="secondary">
              更新于 {dayjs(record.updatedAt).format('MM-DD HH:mm')}
            </Typography.Text>
            {record.audit.length > 0 ? (
              <div className={styles.recordTimeline}>
                <BusinessTimeline events={record.audit} />
              </div>
            ) : null}
          </>
        }
      />
    </List.Item>
  );
}

export const renderRecordItem = (record: BusinessRecord) => (
  <RecordItem key={record.id} record={record} />
);

export function Dashboard({
  repository = enterpriseRepository,
  activeRole,
  refreshToken = 0,
}: DashboardProps) {
  const { styles } = useDashboardStyles();
  const request = useRequest<
    DashboardLoadResult,
    [],
    DashboardLoadResult,
    DashboardLoadResult
  >(
    async () => {
      try {
        return { data: await repository.getDashboard(activeRole) };
      } catch (cause) {
        return {
          error: cause instanceof Error ? cause : new Error('经营数据加载失败'),
        };
      }
    },
    {
      refreshDeps: [activeRole, refreshToken, repository],
      formatResult: (result) => result,
    },
  );
  const data = request.data?.data;
  const error = request.data?.error;

  if (request.loading && !data) {
    return (
      <PageContainer>
        <div aria-label="经营数据加载中" role="status">
          <Skeleton active />
        </div>
      </PageContainer>
    );
  }
  if (error || !data) {
    return (
      <PageContainer>
        <Result
          extra={<Button onClick={() => request.run()}>重试</Button>}
          status="error"
          title="经营数据加载失败"
        />
      </PageContainer>
    );
  }

  const trend = data.trend.flatMap((row) => [
    { date: row.date, value: row.orders, type: '订单' },
    { date: row.date, value: row.delivered, type: '交付' },
  ]);

  return (
    <PageContainer title="经营总览">
      <ProCard gutter={16} wrap>
        {data.metrics.map((metric) => (
          <StatisticCard
            colSpan={{ xs: 24, sm: 12, xl: 6 }}
            footer={
              <Space>
                <Typography.Text type="secondary">较昨日</Typography.Text>
                <Typography.Text
                  className={metric.delta >= 0 ? styles.deltaPositive : styles.deltaNegative}
                >
                  {metric.delta >= 0 ? '+' : ''}{metric.delta}
                </Typography.Text>
              </Space>
            }
            key={metric.key}
            statistic={{ title: metric.label, value: metric.value, suffix: metric.unit }}
          />
        ))}
      </ProCard>

      <ProCard className={`${styles.sectionGap} ${styles.responsiveSplit}`} split="vertical">
        <ProCard title="订单与交付趋势">
          <Line data={trend} xField="date" yField="value" colorField="type" />
        </ProCard>
        <ProCard title="端到端进度">
          <div
            aria-label="制造 ERP 端到端业务流程图"
            className={styles.processFlow}
            role="img"
          >
            <Steps current={3} items={PROCESS_STEPS} responsive={false} titlePlacement="vertical" />
          </div>
        </ProCard>
      </ProCard>

      <ProCard className={`${styles.sectionGap} ${styles.responsiveSplit}`} split="vertical">
        <ProCard title="我的待办">
          <List dataSource={data.todos} renderItem={renderRecordItem} />
        </ProCard>
        <ProCard title="异常预警">
          <List dataSource={data.alerts} renderItem={renderRecordItem} />
        </ProCard>
      </ProCard>
    </PageContainer>
  );
}

interface InitialStateDashboardModel {
  initialState?: AppInitialState;
  loading: boolean;
  error?: Error;
  refresh: () => Promise<void>;
}

export default function ConnectedDashboard({
  repository = enterpriseRepository,
}: { repository?: EnterpriseRepository }) {
  const model = useModel('@@initialState') as InitialStateDashboardModel;
  if (model.loading) {
    return (
      <PageContainer>
        <Result status="info" title="权限策略加载中" />
      </PageContainer>
    );
  }
  if (
    model.initialState?.activeRole &&
    model.initialState.currentPolicy &&
    !model.initialState.currentPrincipal &&
    (!model.initialState.initializationError ||
      model.initialState.initializationError.includes('暂无启用用户'))
  ) {
    return (
      <PageContainer>
        <Result
          extra={<Button onClick={() => model.refresh()}>重试</Button>}
          status="warning"
          title="当前角色暂无启用用户"
        />
      </PageContainer>
    );
  }
  if (
    model.error ||
    !model.initialState?.activeRole ||
    !model.initialState.currentPolicy ||
    model.initialState.initializationError
  ) {
    return (
      <PageContainer>
        <Result
          extra={<Button onClick={() => model.refresh()}>重试</Button>}
          status="warning"
          title="权限策略加载失败"
        />
      </PageContainer>
    );
  }
  return (
    <Dashboard
      activeRole={model.initialState.activeRole}
      refreshToken={model.initialState.dataRevision}
      repository={repository}
    />
  );
}
