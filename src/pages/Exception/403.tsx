import { history } from '@umijs/max';
import { Button, Result } from 'antd';

export interface ForbiddenProps {
  required?: string;
  onDashboard?: () => void;
}

export default function Forbidden({
  onDashboard = () => history.push('/dashboard'),
  required = '当前路由的读取权限',
}: ForbiddenProps) {
  return (
    <Result
      extra={<Button onClick={onDashboard} type="primary">返回经营总览</Button>}
      status="403"
      subTitle={`需要权限：${required}`}
      title="无权访问此页面"
    />
  );
}
