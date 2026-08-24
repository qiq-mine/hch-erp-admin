import { PageContainer } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Card, Descriptions, Result, Space, Tag, Typography } from 'antd';
import type { AppInitialState } from '@/app';

const SCOPE_LABELS = {
  group: '集团范围',
  organization: '组织范围',
  factory: '工厂范围',
  warehouse: '仓库范围',
  self: '本人数据',
} as const;

interface InitialStateModel {
  initialState?: AppInitialState;
  loading: boolean;
}

export default function ProfilePage() {
  const model = useModel('@@initialState') as InitialStateModel;
  const state = model.initialState;
  const principal = state?.currentPrincipal;

  if (model.loading) {
    return <PageContainer><Result status="info" title="个人信息加载中" /></PageContainer>;
  }
  if (!state?.activeRole || !principal || state.initializationError) {
    return <PageContainer><Result status="warning" title="当前个人信息不可用" /></PageContainer>;
  }

  return (
    <PageContainer content="查看当前登录主体、角色策略及有效数据范围。" title="个人中心">
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Card title={principal.actor.name}>
          <Descriptions column={{ lg: 2, md: 2, sm: 1, xs: 1 }}>
            <Descriptions.Item label="用户编号">{principal.actor.userId}</Descriptions.Item>
            <Descriptions.Item label="当前视角">{state.currentPolicy.label}</Descriptions.Item>
            <Descriptions.Item label="数据范围">
              {SCOPE_LABELS[state.currentPolicy.scope]}
            </Descriptions.Item>
            <Descriptions.Item label="组织">
              {principal.access.organizationId || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="工厂">
              {principal.access.factoryId || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="仓库">
              {principal.access.warehouseId || '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
        <Card title="有效权限">
          <Typography.Text strong>可访问领域</Typography.Text>
          <div style={{ marginBottom: 16, marginTop: 8 }}>
            {state.currentPolicy.domains.map((domain) => <Tag key={domain}>{domain}</Tag>)}
          </div>
          <Typography.Text strong>可执行操作</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {state.currentPolicy.actions.map((action) => (
              <Tag color="blue" key={action}>{action === '*' ? '全部操作' : action}</Tag>
            ))}
          </div>
        </Card>
      </Space>
    </PageContainer>
  );
}
