import { history } from '@umijs/max';
import { Button, Result, Space } from 'antd';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  onDashboard?: () => void;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(`[ErrorBoundary] ${error.name}`);
  }

  private dashboard = () => {
    (this.props.onDashboard ?? (() => history.push('/dashboard')))();
  };

  private retry = () => {
    if (this.props.onRetry) {
      this.props.onRetry();
      return;
    }
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Result
        extra={(
          <Space wrap>
            <Button onClick={this.retry} type="primary">重试当前页面</Button>
            <Button onClick={this.dashboard}>返回经营总览</Button>
          </Space>
        )}
        status="500"
        subTitle="未捕获异常已被安全隔离，请重试或返回经营总览"
        title="页面发生异常"
      />
    );
  }
}

export default ErrorBoundary;
