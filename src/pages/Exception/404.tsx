import { history } from '@umijs/max';
import { Button, Result } from 'antd';

export default function NotFound({
  onDashboard = () => history.push('/dashboard'),
}: { onDashboard?: () => void }) {
  return (
    <Result
      extra={<Button onClick={onDashboard} type="primary">返回经营总览</Button>}
      status="404"
      subTitle="请求的业务路径不存在或已被移除"
      title="页面不存在"
    />
  );
}
