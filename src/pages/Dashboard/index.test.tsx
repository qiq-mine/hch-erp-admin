import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInitialState } from '@/app';
import { FAIL_CLOSED_POLICY, ROLE_POLICIES, type RolePolicy } from '@/config/roles';
import type { BusinessRecord, RoleKey } from '@/domain/types';
import { ROLE_COMMIT_KEY, ROLE_STORAGE_KEY } from '@/models/role';
import { createMemoryStorage } from '@/services/enterprise/memoryStorage';
import type { DashboardData, EnterpriseRepository } from '@/services/enterprise';

const initialStateModel = vi.hoisted(() => ({
  current: {
    initialState: undefined as AppInitialState | undefined,
    loading: false,
    error: undefined as Error | undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@umijs/max', async () => {
  const { default: useRequest } = await import('@ahooksjs/use-request');
  return {
    useModel: () => initialStateModel.current,
    useRequest,
  };
});

vi.mock('@ant-design/plots', () => ({
  Line: ({ data }: { data: unknown[] }) => (
    <div aria-label="订单与交付趋势图" role="img">{data.length}</div>
  ),
}));

vi.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
  ProCard: ({ children, title }: { children: ReactNode; title?: string }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
  StatisticCard: ({ statistic }: { statistic: { title: string; value: number; suffix: string } }) => (
    <article>
      <span>{statistic.title}</span>
      <span>{statistic.value}</span>
      <span>{statistic.suffix}</span>
    </article>
  ),
}));

import access from '@/access';
import { layout } from '@/app';
import { filterMenuByRole, loadInitialState } from '@/runtime/appState';
import ConnectedDashboard, { Dashboard } from './index';

const record = (id: string, status: BusinessRecord['status']): BusinessRecord => ({
  id,
  number: id,
  title: `${id} 标题`,
  domain: 'planning',
  status,
  organizationId: 'ORG-01',
  updatedAt: '2026-08-22T08:00:00.000Z',
  audit: [
    {
      id: `${id}-event`,
      recordId: id,
      action: 'submit',
      actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
      occurredAt: '2026-08-22T08:00:00.000Z',
      result: 'success',
      message: '提交成功',
      sourceModule: 'intent-orders',
    },
  ],
  data: {},
});

const dashboardData = (label: string): DashboardData => ({
  metrics: [{ key: 'primary', label, value: 36, unit: '单', delta: 2 }],
  trend: [{ date: '08-22', orders: 36, delivered: 30 }],
  todos: [record('TODO-001', 'submitted')],
  alerts: [record('ALT-001', 'validation-failed')],
});

const repositoryWithDashboard = (
  getDashboard: EnterpriseRepository['getDashboard'],
): EnterpriseRepository => ({ getDashboard }) as EnterpriseRepository;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('application role state and menu', () => {
  it('restores the persisted role and loads its repository policy plus enabled principal', async () => {
    const plannerPolicy: RolePolicy = {
      label: '计划员（临时）',
      domains: ['dashboard', 'planning'],
      actions: ['read'],
      scope: 'self',
    };
    const getRolePolicy = vi.fn().mockResolvedValue(plannerPolicy);
    const plannerPrincipal = {
      actor: { userId: 'u-planner', name: '计划员', role: 'planner' as const },
      access: {
        role: 'planner' as const,
        actorId: 'u-planner',
        organizationId: 'ORG-01',
      },
    };
    const getRolePrincipal = vi.fn().mockResolvedValue(plannerPrincipal);
    const storage = {
      getItem: vi.fn((key: string) => key === ROLE_STORAGE_KEY ? 'planner' : null),
      setItem: vi.fn(),
    };

    await expect(
      loadInitialState(
        { getRolePolicy, getRolePrincipal } as unknown as EnterpriseRepository,
        storage,
      ),
    ).resolves.toEqual({
      activeRole: 'planner',
      currentPolicy: plannerPolicy,
      currentPrincipal: plannerPrincipal,
      dataRevision: 0,
    });
    expect(getRolePolicy).toHaveBeenCalledWith('planner');
    expect(getRolePrincipal).toHaveBeenCalledWith('planner');
  });

  it('fails closed when the persisted role has no enabled principal', async () => {
    await expect(loadInitialState({
      getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.sales),
      getRolePrincipal: vi.fn().mockResolvedValue(undefined),
    } as unknown as EnterpriseRepository, {
      getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'sales' : null,
      setItem: vi.fn(),
    })).resolves.toMatchObject({
      activeRole: 'sales',
      currentPolicy: FAIL_CLOSED_POLICY,
      currentPrincipal: undefined,
      initializationError: expect.stringMatching(/暂无启用用户/),
    });
  });

  it('returns a fail-closed state instead of rejecting when role storage or policy loading fails', async () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: vi.fn(),
    };
    await expect(
      loadInitialState({ getRolePolicy: vi.fn() } as unknown as EnterpriseRepository, brokenStorage),
    ).resolves.toMatchObject({
      activeRole: undefined,
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 0,
      initializationError: expect.stringMatching(/角色视角/),
    });

    const policyFailure = vi.fn().mockRejectedValue(new Error('policy unavailable'));
    await expect(
      loadInitialState(
        { getRolePolicy: policyFailure } as unknown as EnterpriseRepository,
        { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'planner' : null, setItem: vi.fn() },
      ),
    ).resolves.toMatchObject({
      activeRole: 'planner',
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 0,
      initializationError: expect.stringMatching(/权限策略/),
    });
  });

  it.each([
    ['pending', JSON.stringify({ version: 1, status: 'pending', role: 'planner', generation: 7 }), 'planner'],
    ['mismatch', JSON.stringify({ version: 1, status: 'committed', role: 'sales', generation: 7 }), 'planner'],
  ])('rejects an incomplete or mismatched role commit marker: %s', async (_name, marker, role) => {
    const storage = createMemoryStorage({ [ROLE_STORAGE_KEY]: role, [ROLE_COMMIT_KEY]: marker });
    const getRolePolicy = vi.fn();
    await expect(loadInitialState({ getRolePolicy } as unknown as EnterpriseRepository, storage))
      .resolves.toMatchObject({
        activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY,
        initializationError: expect.stringMatching(/角色视角/),
      });
    expect(getRolePolicy).not.toHaveBeenCalled();
  });

  it.each(Object.keys(ROLE_POLICIES) as RoleKey[])(
    'treats a raw role string marker as corruption rather than legacy: %s',
    async (rawMarker) => {
      const storage = createMemoryStorage({
        [ROLE_STORAGE_KEY]: 'planner', [ROLE_COMMIT_KEY]: rawMarker,
      });
      const getRolePolicy = vi.fn();
      await expect(loadInitialState({ getRolePolicy } as unknown as EnterpriseRepository, storage))
        .resolves.toMatchObject({ activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY });
      expect(getRolePolicy).not.toHaveBeenCalled();
    },
  );

  it('safely migrates a legacy role value to a matching committed marker', async () => {
    const storage = createMemoryStorage({ [ROLE_STORAGE_KEY]: 'planner' });
    await loadInitialState({
      getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
      getRolePrincipal: vi.fn().mockResolvedValue({
        actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
        access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
      }),
    } as unknown as EnterpriseRepository, storage);
    expect(JSON.parse(storage.getItem(ROLE_COMMIT_KEY) ?? '{}')).toMatchObject({
      version: 1, status: 'committed', role: 'planner', generation: 0,
    });
  });

  it('fails closed when the default browser localStorage property getter throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    const getRolePolicy = vi.fn();

    try {
      await expect(
        loadInitialState({ getRolePolicy } as unknown as EnterpriseRepository),
      ).resolves.toMatchObject({
        activeRole: undefined,
        currentPolicy: FAIL_CLOSED_POLICY,
        dataRevision: 0,
        initializationError: expect.stringMatching(/角色视角/),
      });
      expect(getRolePolicy).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  });

  it('maps all eight business paths, preserves public routes, and does not mutate nested input', () => {
    const menu = [
      { name: '经营总览', path: '/dashboard' },
      { name: '销售管理', path: '/sales/intents' },
      { name: '生产计划', path: '/planning' },
      { name: '制造执行', path: '/manufacturing' },
      { name: '仓储物流', path: '/warehouse' },
      { name: '财务管理', path: '/finance' },
      { name: '系统集成', path: '/integration' },
      { name: '系统与权限', path: '/security' },
      { name: '帮助', path: '/help' },
      {
        name: '公共入口',
        children: [
          { name: '登录', path: '/login' },
          { name: '异常页', path: '/exception/403' },
        ],
      },
    ];
    const original = structuredClone(menu);

    expect(filterMenuByRole(menu, 'planner').map((item) => item.name)).toEqual([
      '经营总览',
      '销售管理',
      '生产计划',
      '制造执行',
      '帮助',
      '公共入口',
    ]);
    expect(menu).toEqual(original);
    expect(filterMenuByRole(menu, 'admin')).toEqual(menu);
    expect(filterMenuByRole(menu, 'admin')).not.toBe(menu);
  });

  it('uses the repository policy override for both menu and access checks', () => {
    const policy: RolePolicy = {
      label: '计划员（临时）',
      domains: ['dashboard', 'security'],
      actions: ['read', 'permission-change'],
      scope: 'organization',
    };
    const menu = [
      { name: '生产计划', path: '/planning' },
      { name: '系统与权限', path: '/security' },
    ];

    expect(filterMenuByRole(menu, 'planner', policy).map((item) => item.name)).toEqual([
      '系统与权限',
    ]);
    expect(access({
      activeRole: 'planner',
      currentPolicy: policy,
      currentPrincipal: {
        actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
        access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
      },
    })).toMatchObject({
      planning: false,
      security: true,
      permissionChange: true,
    });
  });

  it('hides the permission matrix unless the dynamic policy grants permission-change', () => {
    const readOnlySecurity: RolePolicy = {
      label: '安全审阅', domains: ['security'], actions: ['read'], scope: 'organization',
    };
    const menu = [{ name: '系统与权限', path: '/security', children: [
      { name: '用户管理', path: '/security/users' },
      { name: '权限矩阵', path: '/security/permissions' },
    ] }];

    expect(filterMenuByRole(menu, 'planner', readOnlySecurity)[0]?.children).toEqual([
      { name: '用户管理', path: '/security/users' },
    ]);
  });

  it('keeps only unknown public routes when layout state is absent or failed', () => {
    const menu = [
      { name: '经营总览', path: '/dashboard' },
      { name: '系统与权限', path: '/security' },
      { name: '登录', path: '/login' },
      { name: '帮助', path: '/help' },
    ];

    expect(layout({}).menuDataRender(menu).map((item) => item.name)).toEqual(['登录', '帮助']);
    expect(
      layout({
        initialState: {
          activeRole: 'admin',
          currentPolicy: ROLE_POLICIES.admin,
          dataRevision: 0,
          initializationError: '权限策略加载失败',
        },
      }).menuDataRender(menu).map((item) => item.name),
    ).toEqual(['登录', '帮助']);
  });
});

describe('Dashboard', () => {
  beforeEach(() => {
    initialStateModel.current = {
      initialState: undefined,
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
  });
  it('uses planner metrics after the role changes and ignores the older request result', async () => {
    const admin = deferred<DashboardData>();
    const planner = deferred<DashboardData>();
    const repository = repositoryWithDashboard((role: RoleKey) =>
      role === 'admin' ? admin.promise : planner.promise,
    );
    const view = render(<Dashboard repository={repository} activeRole="admin" />);

    view.rerender(<Dashboard repository={repository} activeRole="planner" />);
    planner.resolve(dashboardData('待排程订单'));
    expect(await screen.findByText('待排程订单')).toBeInTheDocument();

    admin.resolve(dashboardData('集团订单额'));
    await waitFor(() => expect(screen.queryByText('集团订单额')).not.toBeInTheDocument());
  });

  it('ignores an older role failure after the newer role succeeds', async () => {
    const admin = deferred<DashboardData>();
    const planner = deferred<DashboardData>();
    const repository = repositoryWithDashboard((role: RoleKey) =>
      role === 'admin' ? admin.promise : planner.promise,
    );
    const view = render(<Dashboard repository={repository} activeRole="admin" />);

    view.rerender(<Dashboard repository={repository} activeRole="planner" />);
    planner.resolve(dashboardData('待排程订单'));
    expect(await screen.findByText('待排程订单')).toBeInTheDocument();
    admin.reject(new Error('old admin failure'));

    await waitFor(() => expect(screen.queryByText('经营数据加载失败')).not.toBeInTheDocument());
    expect(screen.getByText('待排程订单')).toBeInTheDocument();
  });

  it('does not commit a pending dashboard result after unmount', async () => {
    const pending = deferred<DashboardData>();
    const repository = repositoryWithDashboard(() => pending.promise);
    const view = render(<Dashboard repository={repository} activeRole="planner" />);
    expect(screen.getByLabelText('经营数据加载中')).toBeInTheDocument();

    view.unmount();
    await act(async () => {
      pending.resolve(dashboardData('待排程订单'));
      await pending.promise;
    });

    expect(screen.queryByText('待排程订单')).not.toBeInTheDocument();
  });

  it('renders the metrics, trend, record status/timeline, and eight-step graphical flow', async () => {
    const repository = repositoryWithDashboard(async () => dashboardData('待排程订单'));
    render(<Dashboard repository={repository} activeRole="planner" />);

    expect(await screen.findByText('待排程订单')).toBeInTheDocument();
    expect(screen.getByLabelText('订单与交付趋势图')).toBeInTheDocument();
    expect(screen.getByText('TODO-001 标题')).toBeInTheDocument();
    expect(screen.getByText('校验失败')).toBeInTheDocument();
    expect(screen.getAllByText('提交成功')).not.toHaveLength(0);
    const flow = screen.getByLabelText('制造 ERP 端到端业务流程图');
    for (const label of [
      '订购意向',
      '信用审核',
      '排程合批',
      '生产报工',
      '包装齐套',
      '入库发运',
      '核销分摊',
      '经营分析',
    ]) {
      expect(flow).toHaveTextContent(label);
    }
  });

  it('shows a load failure and retries the current role', async () => {
    const getDashboard = vi
      .fn<EnterpriseRepository['getDashboard']>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(dashboardData('集团订单额'));
    const repository = repositoryWithDashboard(getDashboard);
    render(<Dashboard repository={repository} activeRole="admin" />);

    expect(await screen.findByText('经营数据加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('集团订单额')).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledTimes(2);
  });

  it('does not request an administrator dashboard while initial policy state is missing or failed', async () => {
    const getDashboard = vi.fn().mockResolvedValue(dashboardData('集团订单额'));
    const repository = repositoryWithDashboard(getDashboard);
    initialStateModel.current = {
      initialState: undefined,
      loading: true,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<ConnectedDashboard repository={repository} />);
    expect(screen.getByText('权限策略加载中')).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();

    initialStateModel.current = {
      initialState: {
        activeRole: 'admin',
        dataRevision: 0,
      } as AppInitialState,
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    view.rerender(<ConnectedDashboard repository={repository} />);
    expect(screen.getByText('权限策略加载失败')).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();

    initialStateModel.current = {
      initialState: {
        activeRole: 'admin',
        currentPolicy: ROLE_POLICIES.admin,
        dataRevision: 0,
      },
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    view.rerender(<ConnectedDashboard repository={repository} />);
    expect(screen.getByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();

    const refresh = vi.fn().mockResolvedValue(undefined);
    initialStateModel.current = {
      initialState: {
        activeRole: 'admin',
        currentPolicy: FAIL_CLOSED_POLICY,
        dataRevision: 0,
        initializationError: '权限策略加载失败',
      },
      loading: false,
      error: undefined,
      refresh,
    };
    view.rerender(<ConnectedDashboard repository={repository} />);
    expect(screen.getByText('权限策略加载失败')).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
