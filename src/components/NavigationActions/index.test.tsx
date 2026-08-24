import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider, THEME_STORAGE_KEY } from '@/components/AppThemeProvider';
import { ORGANIZATION_STORAGE_KEY } from '@/components/OrganizationSwitcher';
import { ROLE_POLICIES } from '@/config/roles';
import type { AppInitialState } from '@/runtime/appState';

const umi = vi.hoisted(() => ({
  initialState: undefined as AppInitialState | undefined,
  push: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  history: { push: umi.push },
  useModel: () => ({ initialState: umi.initialState }),
}));

vi.mock('@/components/RoleSwitcher', () => ({
  RoleSwitcher: ({ compact }: { compact?: boolean }) => (
    <button type="button">{compact ? '切换视角' : '当前视角：计划员'}</button>
  ),
}));

import {
  buildNavigationSearchItems,
  NavigationActions,
  NavigationHeader,
} from './index';

const principal = {
  actor: { userId: 'u-planner', name: '计划员', role: 'planner' as const },
  access: {
    role: 'planner' as const,
    actorId: 'u-planner',
    organizationId: 'ORG-01',
  },
};

describe('navigation actions', () => {
  beforeEach(() => {
    umi.push.mockReset();
    window.localStorage.clear();
    umi.initialState = {
      activeRole: 'planner',
      currentPolicy: ROLE_POLICIES.planner,
      currentPrincipal: principal,
      dataRevision: 0,
    };
  });

  it('filters global business search by the current dynamic role policy', () => {
    const items = buildNavigationSearchItems(umi.initialState);
    expect(items).toEqual(expect.arrayContaining([
      { path: '/about', title: '系统介绍' },
      { path: '/account/profile', title: '个人中心' },
      { path: '/planning/schedule', title: '排程工作台' },
      { path: '/manufacturing/tasks', title: '生产任务' },
    ]));
    expect(items.some((item) => item.path === '/security/users')).toBe(false);
    expect(items.some((item) => item.path === '/finance/analysis')).toBe(false);
  });

  it('navigates to the introduction and profile from the header', async () => {
    render(<AppThemeProvider><NavigationActions /></AppThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: '系统介绍' }));
    expect(umi.push).toHaveBeenCalledWith('/about');
    fireEvent.click(screen.getByRole('button', { name: '个人中心' }));
    expect(umi.push).toHaveBeenCalledWith('/account/profile');
  });

  it('switches and persists the current organization', async () => {
    const user = userEvent.setup();
    render(<AppThemeProvider><NavigationHeader defaultDom={null} /></AppThemeProvider>);

    await user.click(screen.getByRole('button', { name: '当前组织：hch-销售公司' }));
    await user.click(await screen.findByText('hch-制造公司'));

    expect(screen.getByRole('button', { name: '当前组织：hch-制造公司' })).toBeInTheDocument();
    expect(window.localStorage.getItem(ORGANIZATION_STORAGE_KEY)).toBe(
      'manufacturing-company',
    );
  });

  it('opens global search and navigates to an authorized result', async () => {
    const user = userEvent.setup();
    render(<AppThemeProvider><NavigationActions /></AppThemeProvider>);

    await user.click(screen.getByRole('button', { name: '全局搜索' }));
    const input = screen.getByRole('combobox', { name: '搜索页面或业务功能' });
    await user.type(input, '排程工作台');
    await user.click(await screen.findByText('排程工作台'));

    expect(umi.push).toHaveBeenCalledWith('/planning/schedule');
  });

  it('toggles and persists dark mode', async () => {
    render(<AppThemeProvider><NavigationActions /></AppThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: '切换为黑暗模式' }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });
    expect(screen.getByRole('button', { name: '切换为明亮模式' })).toBeInTheDocument();
  });
});
