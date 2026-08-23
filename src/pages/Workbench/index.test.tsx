import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInitialState } from '@/app';
import { MOCK_STORAGE_KEY } from '@/config/product';
import { ROLE_POLICIES } from '@/config/roles';
import { createMemoryStorage } from '@/services/enterprise/memoryStorage';
import { createFixtureDatabase } from '@/services/enterprise/fixtures';
import { createMockEnterpriseRepository } from '@/services/enterprise/mockRepository';
import type { EnterpriseRepository } from '@/services/enterprise/types';

const connectedModel = vi.hoisted(() => ({
  pathname: '/planning/batches',
  current: {
    initialState: undefined as AppInitialState | undefined,
    loading: false,
    error: undefined as Error | undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
    setInitialState: vi.fn(),
  },
}));

vi.mock('@umijs/max', () => ({
  useLocation: () => ({ pathname: connectedModel.pathname }),
  useModel: () => connectedModel.current,
}));

import ConnectedWorkbench, { refreshActiveAuthorization, Workbench } from './index';

const instant = async () => undefined;
const makeRepository = () => createMockEnterpriseRepository({
  storage: createMemoryStorage(),
  delay: instant,
  now: () => '2026-08-22T12:00:00.000Z',
});

const renderWorkbench = (
  pathname: string,
  repository: EnterpriseRepository = makeRepository(),
) => ({
  repository,
  ...render(
    // biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute.
    <Workbench
      pathname={pathname}
      policy={ROLE_POLICIES.admin}
      repository={repository}
      role="admin"
    />,
  ),
});

describe('Workbench core loops', () => {
  it('blocks an overloaded batch and names the conflict', async () => {
    const user = userEvent.setup();
    renderWorkbench('/planning/batches');
    await user.click(await screen.findByText('B260827-C'));
    await user.click(screen.getByRole('button', { name: '投放批次' }));
    expect(await screen.findByText(/胡桃木车间.*112%/)).toBeInTheDocument();
  });

  it('releases a batch within capacity', async () => {
    const user = userEvent.setup();
    renderWorkbench('/planning/batches');
    await user.click(await screen.findByText('B260826-A'));
    await user.click(screen.getByRole('button', { name: '投放批次' }));
    expect(await screen.findByText('执行中')).toBeInTheDocument();
  });

  it('reports a duplicate scan without adding a success row', async () => {
    const user = userEvent.setup();
    renderWorkbench('/manufacturing/reporting');
    const before = (await screen.findAllByTestId('successful-scan')).length;
    await user.type(screen.getByRole('textbox', { name: '扫描条码' }), 'PKG-260822-DUP{enter}');
    expect(await screen.findByText('重复扫码')).toBeInTheDocument();
    expect(screen.getAllByTestId('successful-scan')).toHaveLength(before);
  });

  it('creates a package only after the production task makes it fully kitted', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const production = await repository.getRolePrincipal('production');
    if (!production) throw new Error('production principal missing');
    const completed = await repository.perform({
      module: 'production-tasks',
      action: 'complete-task',
      ids: ['PT-260822-0066'],
      actor: production.actor,
      access: production.access,
    });
    expect(completed.success).toBe(true);
    renderWorkbench('/manufacturing/packaging', repository);
    await user.click(await screen.findByText('PKG-READY-001'));
    expect(screen.getByText('齐套率 100%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成包件' }));
    expect(await screen.findByText('包件生成成功')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '补打标签' })).toBeDisabled();
  });

  it('blocks outbound and lists missing package parts while preserving the barcode', async () => {
    const user = userEvent.setup();
    renderWorkbench('/warehouse/outbound');
    const input = await screen.findByRole('textbox', { name: '扫描条码' });
    await user.type(input, 'PKG-NOT-KITTED{enter}');
    expect(await screen.findByText('包件尚未齐套，缺少：门板 × 1')).toBeInTheDocument();
    expect(input).toHaveValue('PKG-NOT-KITTED');
  });

  it('allocates 10001 cents without loss and marks the rounding adjustment', async () => {
    const user = userEvent.setup();
    renderWorkbench('/finance/allocation');
    const input = await screen.findByRole('spinbutton', { name: '待分摊金额' });
    await user.clear(input);
    await user.type(input, '100.01');
    await user.click(screen.getByRole('button', { name: '试算' }));
    expect(await screen.findByText('分摊合计 ¥100.01')).toBeInTheDocument();
    expect(screen.getByText(/尾差调整 0.01 元/)).toBeInTheDocument();
  });

  it('persists a complete permission policy and appends an authorization event', async () => {
    const user = userEvent.setup();
    const { repository } = renderWorkbench('/security/permissions');
    await user.selectOptions(await screen.findByRole('combobox', { name: '角色' }), 'planner');
    await user.click(screen.getByRole('checkbox', { name: '系统集成' }));
    const save = screen.getByRole('button', { name: '保存授权' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(async () => {
      expect((await repository.getRolePolicy('planner')).domains).toContain('integration');
    });
    const policy = await repository.getRolePolicy('planner');
    expect(policy).toEqual(expect.objectContaining({
      label: '计划员',
      scope: 'organization',
      actions: expect.arrayContaining(['read', 'schedule', 'release-batch']),
    }));
    expect((await repository.listAuditEvents()).some((event) => event.action === 'permission-change')).toBe(true);
  });

  it('loads permission audit rows through a trusted categorized record query', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const listAuditEvents = vi.spyOn(repository, 'listAuditEvents');
    renderWorkbench('/security/permissions', repository);
    await waitFor(() => expect(listRecords).toHaveBeenCalledWith('audits', expect.objectContaining({
      auditCategory: 'security',
      access: expect.objectContaining({ actorId: 'u-admin', role: 'admin' }),
    })));
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it('does not let an obsolete permission audit response overwrite a new repository identity', async () => {
    const oldBase = makeRepository();
    const newBase = makeRepository();
    const deferred = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['listRecords']>>>();
    const oldRepository: EnterpriseRepository = {
      ...oldBase,
      listRecords: vi.fn((module, query) => module === 'audits'
        ? deferred.promise
        : oldBase.listRecords(module, query)),
    };
    const auditRecord = {
      id: 'AUDIT-NEW', number: 'AUDIT-NEW', title: '新授权审计', domain: 'security' as const,
      status: 'completed' as const, organizationId: 'ORG-01', updatedAt: '2026-08-22T12:00:00.000Z',
      audit: [], data: { action: 'permission-change' },
    };
    const newRepository: EnterpriseRepository = {
      ...newBase,
      listRecords: vi.fn((module, query) => module === 'audits'
        ? Promise.resolve({ data: [auditRecord], total: 1, success: true as const })
        : newBase.listRecords(module, query)),
    };
    const view = render(
      // biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute.
      <Workbench pathname="/security/permissions" policy={ROLE_POLICIES.admin} repository={oldRepository} role="admin" />,
    );
    await waitFor(() => expect(oldRepository.listRecords).toHaveBeenCalledWith(
      'audits',
      expect.objectContaining({ auditCategory: 'security' }),
    ));
    view.rerender(
      // biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute.
      <Workbench pathname="/security/permissions" policy={ROLE_POLICIES.admin} repository={newRepository} role="admin" />,
    );
    expect(await screen.findByText('新授权审计')).toBeInTheDocument();
    await act(async () => deferred.resolve({
      data: [{ ...auditRecord, id: 'AUDIT-OLD', number: 'AUDIT-OLD', title: '旧授权审计' }],
      total: 1,
      success: true,
    }));
    expect(screen.getByText('新授权审计')).toBeInTheDocument();
    expect(screen.queryByText('旧授权审计')).not.toBeInTheDocument();
  });

  it('loads the latest six permission changes with one authoritative latest query', async () => {
    const storage = createMemoryStorage();
    const database = createFixtureDatabase();
    database.auditEvents = Array.from({ length: 25 }, (_, index) => ({
      id: `PERMISSION-${index}`,
      recordId: 'planner',
      action: 'permission-change' as const,
      actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' as const },
      occurredAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      result: 'success' as const,
      message: `授权审计-${index}`,
      sourceModule: 'roles' as const,
    }));
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(database));
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const listRecords = vi.spyOn(repository, 'listRecords');
    renderWorkbench('/security/permissions', repository);

    expect(await screen.findByText('授权审计-24')).toBeInTheDocument();
    expect(screen.getByText('授权审计-19')).toBeInTheDocument();
    expect(screen.queryByText('授权审计-18')).not.toBeInTheDocument();
    expect(listRecords.mock.calls.filter(([module]) => module === 'audits')).toEqual([[
      'audits',
      expect.objectContaining({
        auditCategory: 'security', auditOrder: 'latest', page: 1, pageSize: 6,
        access: expect.objectContaining({ actorId: 'u-admin', role: 'admin' }),
      }),
    ]]);
  });

  it('filters malformed permission audit rows from a latest projection', async () => {
    const base = makeRepository();
    const valid = {
      id: 'AUDIT-VALID', number: 'AUDIT-VALID', title: '有效授权审计', domain: 'security' as const,
      status: 'completed' as const, organizationId: 'ORG-01', updatedAt: '2026-08-22T12:00:00.000Z',
      audit: [], data: { action: 'permission-change' },
    };
    const repository: EnterpriseRepository = {
      ...base,
      listRecords: vi.fn((module, query) => module === 'audits'
        ? Promise.resolve({
            data: [
              { ...valid, id: 'AUDIT-BAD-DATE', number: 'AUDIT-BAD-DATE', updatedAt: 'not-a-date' },
              { ...valid, id: 'AUDIT-BAD-DATA', number: 'AUDIT-BAD-DATA', data: null },
              valid,
            ] as never[],
            total: 3,
            success: true as const,
          })
        : base.listRecords(module, query)),
    };
    renderWorkbench('/security/permissions', repository);

    expect(await screen.findByText('有效授权审计')).toBeInTheDocument();
    expect(screen.queryByText('not-a-date')).not.toBeInTheDocument();
    expect(screen.queryByText('AUDIT-BAD-DATA')).not.toBeInTheDocument();
  });

  it('does not publish permission success when active authorization refresh fails', async () => {
    const user = userEvent.setup();
    render(
      // biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute.
      <Workbench
        onPolicyChanged={vi.fn().mockRejectedValue(new Error('授权上下文刷新失败'))}
        pathname="/security/permissions"
        policy={ROLE_POLICIES.admin}
        repository={makeRepository()}
        role="admin"
      />,
    );
    const save = await screen.findByRole('button', { name: '保存授权' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    expect(await screen.findByText('授权上下文刷新失败')).toBeInTheDocument();
    expect(screen.queryByText('授权保存成功')).not.toBeInTheDocument();
  });
});

describe('Workbench coverage and authorization boundary', () => {
  it.each([
    ['/planning/schedule', '待排程订单'],
    ['/planning/capacity', '胡桃木车间'],
    ['/warehouse/inbound', '入库确认'],
    ['/warehouse/transfers', 'TR-260822-0003'],
    ['/finance/analysis', '华东家居'],
    ['/integration/monitor', 'CRM'],
    ['/integration/mappings', 'CRM.Order'],
  ])('renders the %s workbench from repository data', async (pathname, expected) => {
    renderWorkbench(pathname);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('fails closed and never reads workbench data when the principal is unavailable', async () => {
    const repository = makeRepository();
    const getWorkbench = vi.spyOn(repository, 'getWorkbench');
    vi.spyOn(repository, 'getRolePrincipal').mockResolvedValue(undefined);
    renderWorkbench('/planning/batches', repository);
    expect(await screen.findByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(getWorkbench).not.toHaveBeenCalled();
  });

  it('schedules a selected order through the trusted repository boundary', async () => {
    const user = userEvent.setup();
    const { repository } = renderWorkbench('/planning/schedule');
    await user.click(await screen.findByText('IO-260822-0184'));
    await user.click(screen.getByRole('button', { name: '确认排程' }));
    await waitFor(async () => {
      const principal = await repository.getRolePrincipal('admin');
      const snapshot = await repository.getWorkbench('schedule', principal?.access);
      const record = (snapshot.records as Array<{ number: string; data: Record<string, unknown> }>).find((row) => row.number === 'IO-260822-0184');
      expect(record?.data.plannedDate).toBe('2026-08-26');
    });
  });

  it('confirms stock-in with an authority-scoped barcode', async () => {
    const user = userEvent.setup();
    renderWorkbench('/warehouse/inbound');
    await user.type(await screen.findByRole('textbox', { name: '扫描条码' }), 'PKG-INBOUND-001{enter}');
    expect(await screen.findByText('扫码入库成功')).toBeInTheDocument();
  });

  it('completes a direct transfer using the selected authoritative transfer record', async () => {
    const user = userEvent.setup();
    renderWorkbench('/warehouse/transfers');
    await user.click(await screen.findByText('TR-260822-0003'));
    await user.click(screen.getByRole('button', { name: '确认调拨' }));
    expect(await screen.findByText('调拨成功')).toBeInTheDocument();
  });

  it('shows a load error and retries with a newly resolved principal', async () => {
    const base = makeRepository();
    const realGetWorkbench = base.getWorkbench.bind(base);
    const getWorkbench = vi.fn()
      .mockRejectedValueOnce(new Error('网络暂不可用'))
      .mockImplementation(realGetWorkbench);
    const getRolePrincipal = vi.spyOn(base, 'getRolePrincipal');
    renderWorkbench('/planning/batches', { ...base, getWorkbench });
    expect(await screen.findByText('工作台数据加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('B260826-A')).toBeInTheDocument();
    expect(getRolePrincipal).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate submissions while an operation is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = makeRepository();
    const realPerform = base.perform.bind(base);
    const perform = vi.fn(async (...args: Parameters<EnterpriseRepository['perform']>) => {
      await gate;
      return realPerform(...args);
    });
    const repository = { ...base, perform };
    const user = userEvent.setup();
    renderWorkbench('/planning/batches', repository);
    await user.click(await screen.findByText('B260826-A'));
    const button = screen.getByRole('button', { name: '投放批次' });
    await user.click(button);
    await user.click(button);
    expect(perform).toHaveBeenCalledTimes(1);
    await act(async () => release?.());
  });

  it('ignores a stale workbench response after retry publishes newer data', async () => {
    const base = makeRepository();
    let resolveOld: ((value: Record<string, unknown>) => void) | undefined;
    const old = new Promise<Record<string, unknown>>((resolve) => { resolveOld = resolve; });
    const getWorkbench = vi.fn()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({ records: [{
        id: 'NEW', number: 'NEW', title: '新数据', domain: 'planning', status: 'audited',
        organizationId: 'ORG-01', updatedAt: '2026-08-22T12:00:00.000Z', audit: [],
        data: { workshop: '新车间', capacityUsage: 0.5, orderCount: 1 },
      }] });
    const repository = { ...base, getWorkbench };
    renderWorkbench('/planning/batches', repository);
    await userEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByText('NEW')).toBeInTheDocument();
    await act(async () => resolveOld?.({ records: [] }));
    expect(screen.getByText('NEW')).toBeInTheDocument();
  });

  it('connected workbench is fail closed during policy loading and never defaults to admin', () => {
    connectedModel.current.initialState = undefined;
    connectedModel.current.loading = true;
    render(<ConnectedWorkbench repository={makeRepository()} />);
    expect(screen.getByText('权限策略加载中')).toBeInTheDocument();
  });

  it('survives the StrictMode effect replay and loads current workbench data', async () => {
    render(
      <StrictMode>
        {/* biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute. */}
        <Workbench pathname="/planning/batches" policy={ROLE_POLICIES.admin} repository={makeRepository()} role="admin" />
      </StrictMode>,
    );
    expect(await screen.findByText('B260826-A')).toBeInTheDocument();
  });

  it('rejects an obsolete connected policy refresh without writing the old role', async () => {
    let currentRole: 'admin' | 'planner' = 'admin';
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const repository = makeRepository();
    const getRolePolicy = repository.getRolePolicy.bind(repository);
    repository.getRolePolicy = async (role) => {
      await gate;
      return getRolePolicy(role);
    };
    const setInitialState = vi.fn();
    const pending = refreshActiveAuthorization({
      repository,
      requestedRole: 'admin',
      isCurrent: () => currentRole === 'admin',
      setInitialState,
    });
    currentRole = 'planner';
    release?.();
    await expect(pending).rejects.toThrow('授权上下文已变化');
    expect(setInitialState).not.toHaveBeenCalled();
  });

  it('disables data scopes that would leave the target role without a trusted principal', async () => {
    renderWorkbench('/security/permissions');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '角色' }), 'planner');
    expect(await screen.findByRole('option', { name: '工厂' })).toBeDisabled();
    expect(screen.getByRole('option', { name: '仓库' })).toBeDisabled();
  });

  it.each([
    ['/planning/capacity', { records: [], days: [null, { date: 3, workshop: {}, usage: 'full' }] }, '暂无有效产能数据'],
    ['/manufacturing/packaging', { records: [null, { id: 3, data: { missingParts: 'bad' } }] }, '暂无有效包装任务'],
    ['/finance/analysis', { records: [], customerProfit: [null, { customer: 3 }], expenseVariance: 'bad' }, '暂无有效客户盈利数据'],
    ['/integration/monitor', { records: [], systems: [null, { name: 3, healthy: 'yes' }] }, '暂无有效通道数据'],
    ['/integration/mappings', { records: [], mappings: [null, { source: 3, target: {}, enabled: 'yes' }] }, '暂无有效映射数据'],
    ['/security/permissions', { records: [], policies: { planner: null } }, '计划员'],
  ])('renders a safe fallback for malformed optional data at %s', async (pathname, snapshot, fallback) => {
    const base = makeRepository();
    const repository = { ...base, getWorkbench: vi.fn().mockResolvedValue(snapshot) };
    renderWorkbench(pathname, repository);
    expect(await screen.findByText(fallback)).toBeInTheDocument();
  });

  it.each([
    ['non-finite kitting rate', { kittingRate: Number.NaN, missingParts: [] }],
    ['out-of-range kitting rate', { kittingRate: 1.2, missingParts: [] }],
    ['negative required quantity', { kittingRate: 1, missingParts: [], requiredQuantity: -1, scannedQuantity: 0 }],
    ['non-integer scanned quantity', { kittingRate: 1, missingParts: [], requiredQuantity: 4, scannedQuantity: 3.5 }],
    ['malformed missing parts', { kittingRate: 1, missingParts: '门板 × 1' }],
    ['rate inconsistent with quantities', { kittingRate: 0.5, missingParts: ['门板 × 1'], requiredQuantity: 4, scannedQuantity: 3 }],
    ['incomplete rate without missing parts', { kittingRate: 0.75, missingParts: [], requiredQuantity: 4, scannedQuantity: 3 }],
    ['complete rate with incomplete quantity', { kittingRate: 1, missingParts: [], requiredQuantity: 4, scannedQuantity: 3 }],
    ['zero required quantity marked incomplete', { kittingRate: 0, missingParts: ['未知缺件'], requiredQuantity: 0, scannedQuantity: 0 }],
  ])('fails closed for packaging records with %s', async (_case, recordData) => {
    const base = makeRepository();
    const repository = {
      ...base,
      getWorkbench: vi.fn().mockResolvedValue({
        records: [{
          id: 'PKG-MALFORMED', number: 'PKG-MALFORMED', title: '畸形包件',
          domain: 'manufacturing', status: 'audited', organizationId: 'ORG-01',
          updatedAt: '2026-08-22T12:00:00.000Z', audit: [], data: recordData,
        }],
      }),
    };
    renderWorkbench('/manufacturing/packaging', repository);
    expect(await screen.findByText('暂无有效包装任务')).toBeInTheDocument();
    expect(screen.queryByText(/NaN%/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成包件' })).toBeDisabled();
  });

  it('defines a zero-required package as complete and allows generation', async () => {
    const base = makeRepository();
    const repository = {
      ...base,
      getWorkbench: vi.fn().mockResolvedValue({
        records: [{
          id: 'PKG-ZERO', number: 'PKG-ZERO', title: '零需求包件',
          domain: 'manufacturing', status: 'audited', organizationId: 'ORG-01',
          updatedAt: '2026-08-22T12:00:00.000Z', audit: [],
          data: { kittingRate: 1, missingParts: [], requiredQuantity: 0, scannedQuantity: 0 },
        }],
      }),
    };
    renderWorkbench('/manufacturing/packaging', repository);
    await userEvent.click(await screen.findByText('PKG-ZERO'));
    expect(screen.getByText('齐套率 100%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成包件' })).toBeEnabled();
  });

  it('hides permission save when the active policy lacks permission-change', async () => {
    render(
      // biome-ignore lint/a11y/useValidAriaRole: `role` is the ERP role-key component prop, not an ARIA attribute.
      <Workbench
        pathname="/security/permissions"
        policy={{ ...ROLE_POLICIES.admin, actions: ['read'] }}
        repository={makeRepository()}
        role="admin"
      />,
    );
    const panel = await screen.findByRole('region', { name: '权限矩阵' });
    expect(within(panel).queryByRole('button', { name: '保存授权' })).not.toBeInTheDocument();
  });
});

beforeEach(() => {
  connectedModel.current.initialState = undefined;
  connectedModel.current.loading = false;
  connectedModel.current.error = undefined;
  connectedModel.current.refresh.mockClear();
  connectedModel.current.setInitialState.mockClear();
});
