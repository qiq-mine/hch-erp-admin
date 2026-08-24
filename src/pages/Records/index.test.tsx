import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInitialState } from '@/app';
import { RecordDetailDrawer } from '@/components/RecordDetailDrawer';
import { FAIL_CLOSED_POLICY, ROLE_POLICIES, type RolePolicy } from '@/config/roles';
import type { BusinessRecord, RoleKey } from '@/domain/types';
import { createMemoryStorage } from '@/services/enterprise/memoryStorage';
import { createMockEnterpriseRepository } from '@/services/enterprise/mockRepository';
import type { EnterpriseRepository, RolePrincipal } from '@/services/enterprise/types';

const connectedModel = vi.hoisted(() => ({
  current: {
    initialState: undefined as AppInitialState | undefined,
    loading: false,
    error: undefined as Error | undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
  },
  pathname: '/sales/intents',
}));

vi.mock('@umijs/max', () => ({
  useLocation: () => ({ pathname: connectedModel.pathname }),
  useModel: () => connectedModel.current,
}));

import ConnectedRecords, { createLatestRequestCoordinator, Records } from './index';

vi.setConfig({ testTimeout: 30_000 });

const instant = async () => undefined;
const makeRepository = () =>
  createMockEnterpriseRepository({
    storage: createMemoryStorage(),
    delay: instant,
    now: () => '2026-08-22T12:00:00.000Z',
  });

const makeRecord = (
  number: string,
  overrides: Partial<BusinessRecord> = {},
): BusinessRecord => ({
  id: number,
  number,
  title: `${number} 测试单据`,
  domain: 'sales',
  status: 'draft',
  organizationId: 'ORG-01',
  ownerId: 'u-sales',
  updatedAt: '2026-08-22T12:00:00.000Z',
  audit: [],
  data: { customer: '测试客户', creditSufficient: true },
  ...overrides,
});

const withList = (
  records: BusinessRecord[],
  base = makeRepository(),
): EnterpriseRepository => ({
  ...base,
  listRecords: vi.fn().mockResolvedValue({
    data: records,
    total: records.length,
    success: true,
  }),
});

const renderIntents = (
  role: 'admin' | 'planner' | 'sales' = 'admin',
  options: { repository?: EnterpriseRepository; policy?: RolePolicy; dataRevision?: number } = {},
) => render(
  <Records
    dataRevision={options.dataRevision}
    pathname="/sales/intents"
    policy={options.policy}
    repository={options.repository ?? makeRepository()}
    role={role}
  />,
);

const recordsElement = (
  pathname: string,
  role: RoleKey,
  repository: EnterpriseRepository,
  policy?: RolePolicy,
  dataRevision = 0,
) => (
  <Records
    dataRevision={dataRevision}
    pathname={pathname}
    policy={policy}
    repository={repository}
    role={role}
  />
);

async function rowFor(number: string) {
  return (await screen.findByText(number)).closest('tr') as HTMLTableRowElement;
}

async function confirmAction(label: string) {
  const buttonName = new RegExp(`确\\s*认${label}`);
  await userEvent.click(screen.getByRole('button', { name: buttonName }));
}

async function createIntentDialog() {
  const titles = await screen.findAllByText('新建订购意向');
  const title = titles.find((element) => element.classList.contains('ant-modal-title'));
  const dialog = title?.closest('[role="dialog"]');
  if (!dialog) throw new Error('create-intent dialog not found');
  return dialog as HTMLElement;
}

async function expectRowStatus(number: string, status: string) {
  await waitFor(() => {
    const row = screen.getByText(number).closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText(status)).toBeInTheDocument();
  });
}

describe('Records', () => {
  beforeEach(() => {
    connectedModel.current = {
      initialState: undefined,
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    connectedModel.pathname = '/sales/intents';
  });

  it('filters intent orders by customer keyword and sends paging plus access scope', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const user = userEvent.setup();
    renderIntents('sales', { repository });

    await user.type(await screen.findByPlaceholderText('客户或单据号'), '华东家居');
    await user.click(screen.getByRole('button', { name: /查\s*询/ }));

    await waitFor(() => {
      expect(screen.getByText('IO-260822-0186')).toBeInTheDocument();
      expect(screen.queryByText('IO-260822-0185')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('combobox', { name: '业务状态' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '组织编码' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '单据编号' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '业务摘要' })).not.toBeInTheDocument();
    expect(listRecords).toHaveBeenLastCalledWith('intent-orders', expect.objectContaining({
      keyword: '华东家居',
      page: 1,
      pageSize: 10,
      access: {
        role: 'sales',
        actorId: 'u-sales',
        organizationId: 'ORG-01',
      },
    }));
  });

  it('resolves a fresh role principal for reads and commands on the same mounted page', async () => {
    const base = withList([makeRecord('IO-DYNAMIC-ADMIN')]);
    const getRolePrincipal = vi.fn()
      .mockResolvedValueOnce({
        actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
        access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
      })
      .mockResolvedValue({
        actor: { userId: 'u-sales', name: '销售员', role: 'admin' },
        access: { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' },
      });
    const perform = vi.fn().mockResolvedValue({
      success: true,
      message: '管理员交接后提交成功',
      affectedIds: ['IO-DYNAMIC-ADMIN'],
      events: [],
    });
    const repository = { ...base, getRolePrincipal, perform } as EnterpriseRepository;
    renderIntents('admin', { repository });

    const row = await rowFor('IO-DYNAMIC-ADMIN');
    await userEvent.click(within(row).getByRole('button', { name: '提交' }));
    await confirmAction('提交');

    await waitFor(() => expect(perform).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: 'u-sales', name: '销售员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' },
    })));
    expect(getRolePrincipal).toHaveBeenCalledWith('admin');
    expect(getRolePrincipal.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed without an enabled principal and never reads or performs', async () => {
    const base = makeRepository();
    const listRecords = vi.fn(base.listRecords);
    const perform = vi.fn(base.perform);
    const repository = {
      ...base,
      getRolePrincipal: vi.fn().mockResolvedValue(undefined),
      listRecords,
      perform,
    } as unknown as EnterpriseRepository;
    renderIntents('sales', { repository });

    expect(await screen.findByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(listRecords).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  it('keeps principal-unavailable state when an older list finishes, then recovers on retry', async () => {
    const oldList = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['listRecords']>>>();
    const initialRecord = makeRecord('IO-PRINCIPAL-RACE');
    const restoredRecord = makeRecord('IO-PRINCIPAL-RESTORED');
    const base = makeRepository();
    let principal: RolePrincipal | undefined = {
      actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
    };
    let listCall = 0;
    const listRecords = vi.fn(() => {
      listCall += 1;
      if (listCall === 1) {
        return Promise.resolve({ data: [initialRecord], total: 1, success: true as const });
      }
      if (listCall === 2) return oldList.promise;
      return Promise.resolve({ data: [restoredRecord], total: 1, success: true as const });
    });
    const perform = vi.fn(base.perform);
    const repository = {
      ...base,
      getRolePrincipal: vi.fn(async () => principal),
      listRecords,
      perform,
    } as EnterpriseRepository;
    renderIntents('admin', { repository });
    const row = await rowFor('IO-PRINCIPAL-RACE');
    await userEvent.click(within(row).getByRole('button', { name: '提交' }));
    expect(screen.getByText('提交操作确认')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('客户或单据号'), {
      target: { value: '旧请求' },
    });
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2), { timeout: 3_000 });

    principal = undefined;
    await confirmAction('提交');
    expect(await screen.findByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(perform).not.toHaveBeenCalled();

    oldList.resolve({
      data: [makeRecord('IO-STALE-PRINCIPAL')],
      total: 1,
      success: true,
    });
    await act(async () => {
      await oldList.promise;
    });
    expect(screen.getByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(screen.queryByText('IO-STALE-PRINCIPAL')).not.toBeInTheDocument();

    principal = {
      actor: { userId: 'u-sales', name: '销售经理', role: 'admin' },
      access: { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' },
    };
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(3), { timeout: 3_000 });
    expect(await screen.findByText('IO-PRINCIPAL-RESTORED')).toBeInTheDocument();
  }, 15_000);

  it('opens the standard detail tabs and formats amount, date, and time', async () => {
    const user = userEvent.setup();
    renderIntents();

    await user.click(await screen.findByText('IO-260822-0186'));

    expect(screen.getByRole('tab', { name: '基本信息' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '资金与成本' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '业务时间线' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '集成日志' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '分录信息' })).not.toBeInTheDocument();
    expect(screen.getByText('2026-08-29')).toBeInTheDocument();
    expect(screen.getByText('2026-08-22 16:00')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '资金与成本' }));
    expect(screen.getByText('¥268,000.00')).toBeInTheDocument();
  });

  it('does not open the detail drawer when an action button is clicked', async () => {
    const user = userEvent.setup();
    renderIntents();
    const row = await rowFor('IO-260822-0184');

    await user.click(within(row).getByRole('button', { name: '提交' }));

    expect(screen.getByText('提交操作确认')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '基本信息' })).not.toBeInTheDocument();
  });

  it('submits and audits a draft intent without losing the selected row', async () => {
    const repository = makeRepository();
    const perform = vi.spyOn(repository, 'perform');
    const listRecords = vi.spyOn(repository, 'listRecords');
    const user = userEvent.setup();
    renderIntents('admin', { repository });
    let row = await rowFor('IO-260822-0184');

    await user.click(within(row).getByRole('button', { name: '提交' }));
    await confirmAction('提交');
    await waitFor(() => {
      expect(perform).toHaveBeenCalledTimes(1);
      expect(listRecords).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000 });
    await expectRowStatus('IO-260822-0184', '已提交');
    row = await rowFor('IO-260822-0184');

    await user.click(within(row).getByRole('button', { name: '审核' }));
    await confirmAction('审核');
    await waitFor(() => {
      expect(perform).toHaveBeenCalledTimes(2);
      expect(listRecords).toHaveBeenCalledTimes(3);
    }, { timeout: 5_000 });
    await expectRowStatus('IO-260822-0184', '已审核');
  }, 15_000);

  it('completes insufficient-credit special approval and order generation', async () => {
    const repository = makeRepository();
    const user = userEvent.setup();
    renderIntents('admin', { repository });
    let row = await rowFor('IO-260822-0185');

    await user.click(within(row).getByRole('button', { name: '审核' }));
    await confirmAction('审核');
    await expectRowStatus('IO-260822-0185', '待特批');
    row = await rowFor('IO-260822-0185');

    await user.click(within(row).getByRole('button', { name: '特批放行' }));
    await confirmAction('特批放行');
    await expectRowStatus('IO-260822-0185', '已审核');
    row = await rowFor('IO-260822-0185');

    await user.click(within(row).getByRole('button', { name: '生成订单' }));
    await confirmAction('生成订单');
    expect(await screen.findByText('下推销售订单成功')).toBeInTheDocument();
    expect((await repository.listRecords('sales-orders')).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ sourceNumber: 'IO-260822-0185' }) }),
      ]),
    );
  }, 15_000);

  it('hides special approval from a planner', async () => {
    renderIntents('planner');
    expect(await screen.findByText('IO-260822-0185')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '特批放行' })).not.toBeInTheDocument();
  });

  it('uses the effective policy override instead of the role default for action buttons', async () => {
    const readOnlySales: RolePolicy = {
      ...ROLE_POLICIES.sales,
      actions: ['read'],
    };
    renderIntents('sales', { policy: readOnlySales });
    const row = await rowFor('IO-260822-0185');

    expect(within(row).queryByRole('button', { name: '审核' })).not.toBeInTheDocument();
  });

  it('keeps the record unchanged and shows service rejection feedback', async () => {
    const base = makeRepository();
    const repository: EnterpriseRepository = {
      ...base,
      perform: vi.fn().mockResolvedValue({
        success: false,
        message: '服务拒绝：演示校验未通过',
        affectedIds: [],
        events: [],
      }),
    };
    const user = userEvent.setup();
    renderIntents('admin', { repository });
    let row = await rowFor('IO-260822-0184');

    await user.click(within(row).getByRole('button', { name: '提交' }));
    await confirmAction('提交');

    expect(await screen.findByText('服务拒绝：演示校验未通过')).toBeInTheDocument();
    row = await rowFor('IO-260822-0184');
    expect(within(row).getByText('草稿')).toBeInTheDocument();
  });

  it('renders a retryable page error and recovers without leaking a rejected request', async () => {
    const base = makeRepository();
    const listRecords = vi
      .fn<EnterpriseRepository['listRecords']>()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementation(base.listRecords);
    const repository = { ...base, listRecords };
    const user = userEvent.setup();
    renderIntents('admin', { repository });

    expect(await screen.findByText('业务数据加载失败')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('IO-260822-0186')).toBeInTheDocument();
    expect(listRecords).toHaveBeenCalledTimes(2);
  });

  it('exposes loading state while the first query is pending', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['listRecords']>>>();
    const base = makeRepository();
    const repository = { ...base, listRecords: vi.fn(() => pending.promise) };
    renderIntents('admin', { repository });

    expect(await screen.findByLabelText('业务数据加载中')).toBeInTheDocument();
    pending.resolve(await base.listRecords('intent-orders'));
    expect(await screen.findByText('IO-260822-0186')).toBeInTheDocument();
  });

  it('fails closed in the connected page before role policy state is ready', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    connectedModel.current = {
      initialState: undefined,
      loading: true,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<ConnectedRecords repository={repository} />);
    expect(screen.getByText('权限策略加载中')).toBeInTheDocument();
    expect(listRecords).not.toHaveBeenCalled();

    connectedModel.current = {
      initialState: {
        activeRole: 'admin',
        currentPolicy: FAIL_CLOSED_POLICY,
        dataRevision: 0,
        initializationError: '权限策略加载失败',
      },
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    view.rerender(<ConnectedRecords repository={repository} />);
    expect(screen.getByText('权限策略加载失败')).toBeInTheDocument();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('fails closed in the connected page when initial state has no role principal', () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    connectedModel.current = {
      initialState: {
        activeRole: 'admin',
        currentPolicy: ROLE_POLICIES.admin,
        dataRevision: 0,
      },
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    render(<ConnectedRecords repository={repository} />);

    expect(screen.getByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('denies reads when an injected effective policy does not grant the page domain', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    renderIntents('admin', { repository, policy: FAIL_CLOSED_POLICY });

    expect(screen.getByText('无权访问此业务页面')).toBeInTheDocument();
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('remounts synchronously and clears drawer state when role identity changes', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const view = renderIntents('admin', { repository });
    await userEvent.click(await screen.findByText('IO-260822-0186'));
    expect(screen.getByRole('tab', { name: '基本信息' })).toBeInTheDocument();

    view.rerender(recordsElement('/sales/intents', 'sales', repository));

    expect(screen.queryByRole('tab', { name: '基本信息' })).not.toBeInTheDocument();
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));
    expect(listRecords).toHaveBeenLastCalledWith(
      'intent-orders',
      expect.objectContaining({ access: expect.objectContaining({ role: 'sales' }) }),
    );
  });

  it('remounts and requests the new module when pathname identity changes', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const view = renderIntents('admin', { repository });
    await userEvent.click(await screen.findByText('IO-260822-0186'));

    view.rerender(recordsElement('/sales/orders', 'admin', repository));

    expect(screen.queryByRole('tab', { name: '基本信息' })).not.toBeInTheDocument();
    expect(await screen.findByText('SO-260821-0098')).toBeInTheDocument();
    expect(listRecords).toHaveBeenLastCalledWith('sales-orders', expect.any(Object));
  });

  it('treats the complete effective-policy signature, including scope, as identity', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const organizationPolicy: RolePolicy = { ...ROLE_POLICIES.sales };
    const selfPolicy: RolePolicy = { ...organizationPolicy, scope: 'self' };
    const view = renderIntents('sales', { repository, policy: organizationPolicy });
    await userEvent.click(await screen.findByText('IO-260822-0186'));

    view.rerender(recordsElement('/sales/intents', 'sales', repository, selfPolicy));

    expect(screen.queryByRole('tab', { name: '基本信息' })).not.toBeInTheDocument();
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));
  });

  it('isolates repositories and ignores an older list promise resolved in reverse order', async () => {
    const oldRequest = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['listRecords']>>>();
    const newRequest = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['listRecords']>>>();
    const oldRepository = withList([]);
    const newRepository = withList([]);
    oldRepository.listRecords = vi.fn(() => oldRequest.promise);
    newRepository.listRecords = vi.fn(() => newRequest.promise);
    const view = renderIntents('admin', { repository: oldRepository });
    await waitFor(() => expect(oldRepository.listRecords).toHaveBeenCalledTimes(1));

    view.rerender(recordsElement('/sales/intents', 'admin', newRepository));
    await waitFor(() => expect(newRepository.listRecords).toHaveBeenCalledTimes(1));
    newRequest.resolve({ data: [makeRecord('IO-NEW')], total: 1, success: true });
    expect(await screen.findByText('IO-NEW')).toBeInTheDocument();

    oldRequest.resolve({ data: [makeRecord('IO-STALE')], total: 1, success: true });
    await act(async () => undefined);
    expect(screen.queryByText('IO-STALE')).not.toBeInTheDocument();
    expect(screen.getByText('IO-NEW')).toBeInTheDocument();
  });

  it('keeps the newest keyword result when requests from the same identity resolve in reverse order', async () => {
    const coordinator = createLatestRequestCoordinator<{ keyword: string }>();
    const stale = Promise.withResolvers<{ keyword: string }>();
    const latest = Promise.withResolvers<{ keyword: string }>();
    const applied: string[] = [];
    const staleRequest = coordinator.run(() => stale.promise, {
      onLatest: (value) => applied.push(value.keyword),
    });
    const latestRequest = coordinator.run(() => latest.promise, {
      onLatest: (value) => applied.push(value.keyword),
    });

    latest.resolve({ keyword: '最新' });
    await expect(latestRequest).resolves.toEqual({ keyword: '最新' });
    stale.resolve({ keyword: '旧条件' });

    await expect(staleRequest).resolves.toEqual({ keyword: '最新' });
    expect(applied).toEqual(['最新']);
  });

  it('keeps the newest pagination result when an older page resolves last', async () => {
    const coordinator = createLatestRequestCoordinator<{ page: number }>();
    const stalePage = Promise.withResolvers<{ page: number }>();
    const latestPage = Promise.withResolvers<{ page: number }>();
    const staleRequest = coordinator.run(() => stalePage.promise);
    const latestRequest = coordinator.run(() => latestPage.promise);

    latestPage.resolve({ page: 1 });
    await expect(latestRequest).resolves.toEqual({ page: 1 });
    stalePage.resolve({ page: 2 });

    await expect(staleRequest).resolves.toEqual({ page: 1 });
  });

  it('prevents StrictMode stale requests from replacing the latest query result', async () => {
    const repository = withList([makeRecord('IO-STRICT-LATEST')]);
    const listRecords = vi.spyOn(repository, 'listRecords');
    render(
      <StrictMode>
        {recordsElement('/sales/intents', 'admin', repository)}
      </StrictMode>,
    );

    expect(await screen.findByText('IO-STRICT-LATEST')).toBeInTheDocument();
    expect(listRecords).toHaveBeenCalled();
    expect(screen.queryByText('业务数据加载失败')).not.toBeInTheDocument();
  });

  it('does not let a slow old principal request overwrite a newer principal query', async () => {
    const oldPrincipal = Promise.withResolvers<RolePrincipal | undefined>();
    const replacementPrincipal: RolePrincipal = {
      actor: { userId: 'u-sales', name: '销售员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' },
    };
    const repository = {
      getRolePrincipal: vi.fn()
        .mockImplementationOnce(() => oldPrincipal.promise)
        .mockResolvedValue(replacementPrincipal),
    } as unknown as EnterpriseRepository;
    const coordinator = createLatestRequestCoordinator<string>();
    const resolveActor = async () =>
      (await repository.getRolePrincipal('admin'))?.actor.userId ?? 'none';
    const older = coordinator.run(resolveActor);
    const newer = coordinator.run(resolveActor);

    await expect(newer).resolves.toBe('u-sales');

    oldPrincipal.resolve({
      actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
    });
    await expect(older).resolves.toBe('u-sales');
  });

  it('locks confirmation synchronously against same-frame double submit', async () => {
    const deferred = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['perform']>>>();
    const base = makeRepository();
    const repository: EnterpriseRepository = {
      ...base,
      perform: vi.fn(() => deferred.promise),
    };
    renderIntents('admin', { repository });
    const row = await rowFor('IO-260822-0184');
    await userEvent.click(within(row).getByRole('button', { name: '提交' }));
    const confirm = screen.getByRole('button', { name: /确\s*认提交/ });

    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('提交操作确认')).toBeInTheDocument();
    await waitFor(() => expect(repository.perform).toHaveBeenCalledTimes(1));
    deferred.resolve({ success: true, message: '操作成功', affectedIds: ['IO-260822-0184'], events: [] });
    await act(async () => undefined);
    expect(repository.perform).toHaveBeenCalledTimes(1);
  });

  it('does not let an old pending operation update feedback after identity changes', async () => {
    const deferred = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['perform']>>>();
    const oldBase = makeRepository();
    const oldRepository: EnterpriseRepository = {
      ...oldBase,
      perform: vi.fn(() => deferred.promise),
    };
    const newRepository = withList([makeRecord('IO-NEW-SCOPE')]);
    const view = renderIntents('admin', { repository: oldRepository });
    const row = await rowFor('IO-260822-0184');
    await userEvent.click(within(row).getByRole('button', { name: '提交' }));
    await confirmAction('提交');

    view.rerender(recordsElement('/sales/intents', 'sales', newRepository));
    expect(screen.queryByText('提交操作确认')).not.toBeInTheDocument();
    expect(await screen.findByText('IO-NEW-SCOPE')).toBeInTheDocument();

    deferred.resolve({ success: true, message: '旧身份操作成功', affectedIds: ['IO-260822-0184'], events: [] });
    await act(async () => undefined);
    expect(screen.queryByText('旧身份操作成功')).not.toBeInTheDocument();
    expect(newRepository.listRecords).toHaveBeenCalledTimes(1);
  });

  it('offers one atomic batch command only for actions valid for every selected row', async () => {
    const rows = [makeRecord('IO-BATCH-1'), makeRecord('IO-BATCH-2')];
    const repository = withList(rows);
    const perform = vi.spyOn(repository, 'perform');
    renderIntents('admin', { repository });
    const first = await rowFor('IO-BATCH-1');
    const second = await rowFor('IO-BATCH-2');
    await userEvent.click(within(first).getByRole('checkbox'));
    await userEvent.click(within(second).getByRole('checkbox'));

    await userEvent.click(screen.getByRole('button', { name: '批量提交' }));
    expect(screen.getByText('2 条业务记录')).toBeInTheDocument();
    await confirmAction('提交');

    await waitFor(() => expect(perform).toHaveBeenCalledWith(expect.objectContaining({
      action: 'submit',
      ids: ['IO-BATCH-1', 'IO-BATCH-2'],
    })), { timeout: 5_000 });
  }, 15_000);

  it('clears selected snapshots whenever a new keyword query starts', async () => {
    const repository = withList([makeRecord('IO-SELECT-QUERY')]);
    const listRecords = vi.spyOn(repository, 'listRecords');
    renderIntents('admin', { repository });
    const row = await rowFor('IO-SELECT-QUERY');
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: '批量提交' })).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('客户或单据号'), '新条件');
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '批量提交' })).not.toBeInTheDocument());
    expect(within(await rowFor('IO-SELECT-QUERY')).getByRole('checkbox')).not.toBeChecked();
  }, 15_000);

  it('clears selected snapshots when the standard table reload starts', async () => {
    const repository = withList([makeRecord('IO-SELECT-RELOAD')]);
    const listRecords = vi.spyOn(repository, 'listRecords');
    renderIntents('admin', { repository });
    const row = await rowFor('IO-SELECT-RELOAD');
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: '批量提交' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('img', { name: 'reload' }));

    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '批量提交' })).not.toBeInTheDocument());
  }, 15_000);

  it('clears selected snapshots when pagination starts', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => makeRecord(`IO-PAGE-A-${index}`));
    const secondPage = [makeRecord('IO-PAGE-B-1')];
    const base = makeRepository();
    const repository: EnterpriseRepository = {
      ...base,
      listRecords: vi.fn(async (_module, query = {}) => ({
        data: query.page === 2 ? secondPage : firstPage,
        total: 11,
        success: true as const,
      })),
    };
    const listRecords = vi.mocked(repository.listRecords);
    renderIntents('admin', { repository });
    const row = await rowFor('IO-PAGE-A-0');
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: '批量提交' })).toBeInTheDocument();

    await userEvent.click(screen.getByTitle('2'));

    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    expect(await screen.findByText('IO-PAGE-B-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批量提交' })).not.toBeInTheDocument();
  }, 15_000);

  it('remounts and reloads when dataRevision changes without another identity change', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const view = renderIntents('admin', { repository, dataRevision: 0 });
    await userEvent.click(await screen.findByText('IO-260822-0186'));
    expect(screen.getByRole('tab', { name: '基本信息' })).toBeInTheDocument();

    view.rerender(recordsElement('/sales/intents', 'admin', repository, undefined, 1));

    expect(screen.queryByRole('tab', { name: '基本信息' })).not.toBeInTheDocument();
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));
  });

  it('passes connected initial-state dataRevision into the records identity', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    connectedModel.current = {
      initialState: {
        activeRole: 'admin',
        currentPolicy: ROLE_POLICIES.admin,
        currentPrincipal: {
          actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
          access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
        },
        dataRevision: 0,
      },
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<ConnectedRecords repository={repository} />);
    expect(await screen.findByText('IO-260822-0186')).toBeInTheDocument();

    connectedModel.current = {
      ...connectedModel.current,
      initialState: {
        activeRole: 'admin',
        currentPolicy: ROLE_POLICIES.admin,
        currentPrincipal: {
          actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
          access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
        },
        dataRevision: 1,
      },
    };
    view.rerender(<ConnectedRecords repository={repository} />);

    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));
  });

  it('shows no dead selection controls for an effective read-only policy', async () => {
    const readOnlySales: RolePolicy = { ...ROLE_POLICIES.sales, actions: ['read'] };
    renderIntents('sales', { policy: readOnlySales });
    expect(await screen.findByText('IO-260822-0186')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('creates an intent and completes the create-submit-audit happy path', async () => {
    const repository = makeRepository();
    renderIntents('sales', { repository });
    await userEvent.click(await screen.findByRole('button', { name: '新建订购意向' }));
    const dialog = await createIntentDialog();
    await userEvent.type(within(dialog).getByLabelText('单据编号'), 'IO-260823-0001');
    await userEvent.type(within(dialog).getByLabelText('业务摘要'), '华北旗舰店订购意向');
    await userEvent.type(within(dialog).getByLabelText('客户'), '华北旗舰店');
    await userEvent.type(within(dialog).getByLabelText('金额'), '188000');
    await userEvent.click(within(dialog).getByRole('button', { name: /创\s*建/ }));

    let row = await rowFor('IO-260823-0001');
    await userEvent.click(within(row).getByRole('button', { name: '提交' }));
    await confirmAction('提交');
    await expectRowStatus('IO-260823-0001', '已提交');
    row = await rowFor('IO-260823-0001');
    await userEvent.click(within(row).getByRole('button', { name: '审核' }));
    await confirmAction('审核');
    await expectRowStatus('IO-260823-0001', '已审核');
  }, 15_000);

  it('keeps the create-intent modal open after a service rejection and hides the entry from planners', async () => {
    const base = makeRepository();
    const repository: EnterpriseRepository = {
      ...base,
      perform: vi.fn().mockResolvedValue({
        success: false,
        message: '订购意向编号已存在',
        affectedIds: [],
        events: [],
      }),
    };
    const view = renderIntents('sales', { repository });
    await userEvent.click(await screen.findByRole('button', { name: '新建订购意向' }));
    const dialog = await createIntentDialog();
    await userEvent.type(within(dialog).getByLabelText('单据编号'), 'IO-DUP');
    await userEvent.type(within(dialog).getByLabelText('业务摘要'), '重复意向');
    await userEvent.type(within(dialog).getByLabelText('客户'), '重复客户');
    await userEvent.type(within(dialog).getByLabelText('金额'), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: /创\s*建/ }));
    expect(await screen.findByText('订购意向编号已存在')).toBeInTheDocument();
    expect(await createIntentDialog()).toBeInTheDocument();

    view.rerender(recordsElement('/sales/intents', 'planner', base));
    expect(screen.queryByRole('button', { name: '新建订购意向' })).not.toBeInTheDocument();
  });

  it('passes the page-specific audit category to the shared audits repository', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    const view = render(recordsElement('/integration/audits', 'admin', repository));
    await waitFor(() => expect(listRecords).toHaveBeenLastCalledWith(
      'audits',
      expect.objectContaining({ auditCategory: 'integration' }),
    ));

    view.rerender(recordsElement('/security/audits', 'admin', repository));
    await waitFor(() => expect(listRecords).toHaveBeenLastCalledWith(
      'audits',
      expect.objectContaining({ auditCategory: 'security' }),
    ));
  });

  it('shows complete sync detail and retains failed plus successful attempts after retry', async () => {
    const repository = makeRepository();
    render(recordsElement('/integration/tasks', 'admin', repository));
    await userEvent.click(await screen.findByText('SYNC-FAIL-001'));
    expect(screen.getByText('WMS-TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('ERP → WMS')).toBeInTheDocument();
    expect(screen.getByText('出库单')).toBeInTheDocument();
    expect(screen.getByText('出库任务')).toBeInTheDocument();
    expect(screen.getByText('目标系统响应超时')).toBeInTheDocument();
    expect(screen.getByText('尝试次数').parentElement).toHaveTextContent('1');

    await userEvent.click(screen.getAllByRole('button', { name: '重试同步' }).at(-1) as HTMLElement);
    await confirmAction('重试同步');
    expect(await screen.findByText('重试成功')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('tab', { name: '集成日志' }));
    expect(await screen.findByText('WMS-TIMEOUT：目标系统响应超时')).toBeInTheDocument();
    expect(screen.getByText(/同步重试成功/)).toBeInTheDocument();
    expect(screen.getByText('尝试次数').parentElement).toHaveTextContent('2');
  }, 15_000);

  it('loads a current principal before retry and keeps the failure visible when it disappears', async () => {
    const base = makeRepository();
    let principalCalls = 0;
    const repository: EnterpriseRepository = {
      ...base,
      getRolePrincipal: vi.fn(async (role) => {
        principalCalls += 1;
        return principalCalls === 1 ? base.getRolePrincipal(role) : undefined;
      }),
      perform: vi.fn(base.perform),
    };
    render(recordsElement('/integration/tasks', 'admin', repository));
    await userEvent.click(await screen.findByText('SYNC-FAIL-001'));
    await userEvent.click(screen.getAllByRole('button', { name: '重试同步' }).at(-1) as HTMLElement);
    await confirmAction('重试同步');

    expect(await screen.findByText('当前角色暂无启用用户')).toBeInTheDocument();
    expect(repository.perform).not.toHaveBeenCalled();
  });

  it('submits a structured order change, reloads, and persists its audit', async () => {
    const repository = makeRepository();
    const perform = vi.spyOn(repository, 'perform');
    const listRecords = vi.spyOn(repository, 'listRecords');
    render(recordsElement('/sales/changes', 'sales', repository));
    const row = await rowFor('OC-260822-0007');
    await userEvent.click(within(row).getByRole('button', { name: '发起变更' }));
    const title = await screen.findByText('订单变更', { selector: '.ant-modal-title' });
    const dialog = title.closest('[role="dialog"]') as HTMLElement;
    await userEvent.type(within(dialog).getByRole('textbox', { name: '变更原因' }), '客户调整交期');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '新交付日期' }), '2026-09-15');
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: '数量调整' }), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存变更' }));

    expect(await screen.findByText('订单变更已保存')).toBeInTheDocument();
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({
      module: 'order-changes', action: 'change-order', ids: ['OC-260822-0007'],
      access: expect.objectContaining({ role: 'sales', actorId: 'u-sales' }),
      payload: { changes: { reason: '客户调整交期', deliveryDate: '2026-09-15', quantityDelta: 2 } },
    }));
    await waitFor(() => expect(listRecords.mock.calls.length).toBeGreaterThan(1));
    const changed = (await repository.listRecords('order-changes', { keyword: 'OC-260822-0007' })).data[0];
    expect(changed.data.changes).toEqual({ reason: '客户调整交期', deliveryDate: '2026-09-15', quantityDelta: 2 });
    expect(changed.audit.at(-1)?.action).toBe('change-order');
  }, 30_000);

  it('keeps order-change input after a service failure and ignores stale success feedback', async () => {
    const base = makeRepository();
    const deferred = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['perform']>>>();
    let mode: 'failure' | 'deferred' = 'failure';
    const repository: EnterpriseRepository = {
      ...base,
      perform: vi.fn(async (_command) => mode === 'failure'
        ? { success: false, message: '变更校验失败', affectedIds: [], events: [] }
        : deferred.promise),
    };
    const view = render(recordsElement('/sales/changes', 'sales', repository));
    await userEvent.click(within(await rowFor('OC-260822-0007')).getByRole('button', { name: '发起变更' }));
    const dialog = (await screen.findByText('订单变更', { selector: '.ant-modal-title' })).closest('[role="dialog"]') as HTMLElement;
    await userEvent.type(within(dialog).getByRole('textbox', { name: '变更原因' }), '保留此原因');
    await userEvent.type(within(dialog).getByRole('textbox', { name: '新交付日期' }), '2026-09-20');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存变更' }));
    expect(await screen.findByText('变更校验失败')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: '变更原因' })).toHaveValue('保留此原因');

    mode = 'deferred';
    await userEvent.click(within(dialog).getByRole('button', { name: '保存变更' }));
    view.rerender(recordsElement('/sales/changes', 'admin', repository, undefined, 1));
    deferred.resolve({ success: true, message: '过期变更成功', affectedIds: ['OC-260822-0007'], events: [] });
    await act(async () => { await deferred.promise; });
    expect(screen.queryByText('过期变更成功')).not.toBeInTheDocument();
  }, 30_000);

  it('performs real user and role management with repository payloads', async () => {
    const repository = makeRepository();
    const view = render(recordsElement('/security/users', 'admin', repository));
    const userRow = await rowFor('u-sales');
    await userEvent.click(within(userRow).getByRole('button', { name: '维护用户' }));
    const userTitle = await screen.findByText('维护用户', { selector: '.ant-modal-title' });
    const userDialog = userTitle.closest('[role="dialog"]') as HTMLElement;
    await userEvent.selectOptions(within(userDialog).getByRole('combobox', { name: '角色' }), 'planner');
    await userEvent.click(within(userDialog).getByRole('checkbox', { name: '启用账号' }));
    await userEvent.click(within(userDialog).getByRole('button', { name: '保存用户' }));
    expect(await screen.findByText('用户信息已更新')).toBeInTheDocument();
    expect((await repository.listRecords('users', { keyword: 'u-sales' })).data[0].data)
      .toMatchObject({ role: 'planner', enabled: false });

    view.rerender(recordsElement('/security/roles', 'admin', repository, undefined, 1));
    const roleRow = await rowFor('ROLE-PLANNER');
    await userEvent.click(within(roleRow).getByRole('button', { name: '维护角色' }));
    const roleTitle = await screen.findByText('维护角色', { selector: '.ant-modal-title' });
    const roleDialog = roleTitle.closest('[role="dialog"]') as HTMLElement;
    const members = within(roleDialog).getByRole('spinbutton', { name: '成员数' });
    await userEvent.clear(members);
    await userEvent.type(members, '6');
    const responsibility = within(roleDialog).getByRole('textbox', { name: '职责' });
    await userEvent.clear(responsibility);
    await userEvent.type(responsibility, '计划与产能统筹');
    await userEvent.click(within(roleDialog).getByRole('button', { name: '保存角色' }));
    expect(await screen.findByText('角色信息已更新')).toBeInTheDocument();
    expect((await repository.listRecords('roles', { keyword: 'ROLE-PLANNER' })).data[0].data)
      .toMatchObject({ members: 6, responsibility: '计划与产能统筹' });
  }, 15_000);

  it('sends actor, action, result, and date filters only to categorized audit reads', async () => {
    const repository = makeRepository();
    const listRecords = vi.spyOn(repository, 'listRecords');
    render(recordsElement('/security/audits', 'admin', repository));
    await screen.findByRole('button', { name: /查\s*询/ });
    await userEvent.type(screen.getByRole('textbox', { name: '审计操作人' }), '系统管理员');
    await userEvent.type(screen.getByRole('textbox', { name: '操作类型' }), 'permission-change');
    await userEvent.type(screen.getByRole('textbox', { name: '执行结果' }), 'success');
    await userEvent.type(screen.getByRole('textbox', { name: '发生日期' }), '2026-08-22');
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    await waitFor(() => expect(listRecords).toHaveBeenLastCalledWith('audits', expect.objectContaining({
      auditCategory: 'security', auditActor: '系统管理员', auditAction: 'permission-change',
      auditResult: 'success', auditDate: '2026-08-22',
    })));
  }, 30_000);
});

describe('RecordDetailDrawer defensive rendering', () => {
  it('filters malformed entries, unions columns, uses a safe value fallback, and hides non-finite funds', async () => {
    const first: Record<string, unknown> = { material: '橡木' };
    const second: Record<string, unknown> = { quantity: 2 };
    second.circular = second;
    const record = makeRecord('IO-MALFORMED', {
      amount: Number.NaN,
      data: {
        entries: [null, [], first, second],
        totalCents: Number.POSITIVE_INFINITY,
      },
    });
    render(
      <RecordDetailDrawer open record={record} onClose={() => undefined} />,
    );

    expect(screen.queryByRole('tab', { name: '资金与成本' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '分录信息' }));
    expect(screen.getByRole('columnheader', { name: 'material' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'quantity' })).toBeInTheDocument();
    expect(screen.getByText('橡木')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('[object Object]')).toBeInTheDocument();
  });

  it('does not show an entries tab when every plain entry has zero display columns', () => {
    render(
      <RecordDetailDrawer
        open
        record={makeRecord('IO-EMPTY-ENTRIES', { data: { entries: [{}] } })}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByRole('tab', { name: '分录信息' })).not.toBeInTheDocument();
  });
});
