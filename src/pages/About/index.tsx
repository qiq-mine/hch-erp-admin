import {
  ApiOutlined,
  AuditOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Card, Col, Row, Space, Steps, Tag, Typography } from 'antd';
import { PRODUCT_NAME } from '@/config/product';

const PROCESS_STEPS = [
  { title: '订购意向', description: '客户需求与信用校验' },
  { title: '销售订单', description: '审核、变更与下推' },
  { title: '计划排程', description: '产能校验与合批投放' },
  { title: '制造执行', description: '任务、报工与包装齐套' },
  { title: '仓储履约', description: '入库、出库与调拨' },
  { title: '业财核算', description: '对账、成本与经营分析' },
];

export default function AboutPage() {
  return (
    <PageContainer
      content="面向现代离散制造企业的端到端经营、制造、仓储、财务与集成协同平台。"
      title={PRODUCT_NAME}
    >
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Alert
          description="当前版本使用本地 Mock 仓储演示业务闭环、动态权限与异常反馈，不连接真实生产系统。"
          message="V1.5 交互原型"
          showIcon
          type="info"
        />
        <Card title="端到端业务流程">
          <Steps items={PROCESS_STEPS} responsive size="small" />
        </Card>
        <Row gutter={[16, 16]}>
          <Col lg={8} xs={24}>
            <Card title={<><AuditOutlined /> 业务闭环</>}>
              <Typography.Paragraph>
                覆盖销售、计划、生产、仓储与业财核算，关键业务操作具备状态校验和结果反馈。
              </Typography.Paragraph>
              <Tag color="blue">28 个业务页面</Tag>
            </Card>
          </Col>
          <Col lg={8} xs={24}>
            <Card title={<><SafetyCertificateOutlined /> 权限治理</>}>
              <Typography.Paragraph>
                支持七类角色视角、菜单过滤、操作权限和组织/工厂/仓库数据范围控制。
              </Typography.Paragraph>
              <Tag color="green">动态策略</Tag>
              <Tag color="green">默认拒绝</Tag>
            </Card>
          </Col>
          <Col lg={8} xs={24}>
            <Card title={<><ApiOutlined /> 系统集成</>}>
              <Typography.Paragraph>
                提供同步监控、失败重试、数据映射和审计追踪视图，呈现跨系统集成治理方式。
              </Typography.Paragraph>
              <Tag color="purple">可追踪</Tag>
              <Tag color="purple">可重试</Tag>
            </Card>
          </Col>
        </Row>
      </Space>
    </PageContainer>
  );
}
