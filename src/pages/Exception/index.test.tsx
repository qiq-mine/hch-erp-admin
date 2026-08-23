import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import Forbidden from './403';
import NotFound from './404';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('@umijs/max', () => ({ history: { push: vi.fn() } }));

it('explains the exact permission required by a denied route', () => {
  render(<Forbidden required="security.permission-change" />);
  expect(screen.getByText(/需要权限：security\.permission-change/)).toBeInTheDocument();
});

it('offers a dashboard return from the not-found page', async () => {
  const onDashboard = vi.fn();
  render(<NotFound onDashboard={onDashboard} />);
  expect(screen.getByText('页面不存在')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '返回经营总览' }));
  expect(onDashboard).toHaveBeenCalledOnce();
});

describe('ErrorBoundary', () => {
  it('renders a non-blank safe fallback and logs only an error summary', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRetry = vi.fn();
    const onDashboard = vi.fn();
    class Crasher extends Component {
      render(): ReactNode {
        throw new Error('fixture-secret-payload');
      }
    }
    render(<ErrorBoundary onDashboard={onDashboard} onRetry={onRetry}><Crasher /></ErrorBoundary>);
    expect(screen.getByText('页面发生异常')).toBeInTheDocument();
    expect(screen.queryByText(/fixture-secret-payload/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试当前页面' }));
    await userEvent.click(screen.getByRole('button', { name: '返回经营总览' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDashboard).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith('[ErrorBoundary] Error');
    consoleError.mockRestore();
  });
});
