import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppInitialState } from '@/app';
import { FAIL_CLOSED_POLICY, ROLE_POLICIES } from '@/config/roles';
import { ROLE_STORAGE_KEY } from '@/models/role';
import type { EnterpriseRepository } from '@/services/enterprise';

const initialStateModel = vi.hoisted(() => ({
  current: {
    initialState: undefined as AppInitialState | undefined,
    loading: false,
    error: undefined as Error | undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
    setInitialState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@umijs/max', () => ({
  useModel: () => initialStateModel.current,
}));

import { actorForRole, createRoleSwitcherActions, RoleSwitcher } from './index';

const principalFor = (role: keyof typeof ROLE_POLICIES) => {
  const actor = actorForRole(role);
  return {
    actor,
    access: {
      role,
      actorId: actor.userId,
      organizationId: 'ORG-01',
      ...(role === 'production' || role === 'warehouse' ? { factoryId: 'F-01' } : {}),
      ...(role === 'warehouse' ? { warehouseId: 'WH-02' } : {}),
    },
  };
};

describe('RoleSwitcher', () => {
  it('switches from 系统管理员 to 计划员', async () => {
    const onSwitch = vi.fn();
    render(<RoleSwitcher activeRole="admin" onSwitch={onSwitch} />);

    fireEvent.click(screen.getByRole('button', { name: /当前视角：系统管理员/ }));
    fireEvent.click(await screen.findByText('计划员'));

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('planner'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /当前视角：系统管理员/ })).not.toHaveClass(
        'ant-btn-loading',
      ),
    );
  });

  it('offers demo reset only to the administrator', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <RoleSwitcher activeRole="admin" canReset onSwitch={vi.fn()} onReset={onReset} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /当前视角：系统管理员/ }));
    fireEvent.click(await screen.findByText('重置演示数据'));
    await waitFor(() => expect(onReset).toHaveBeenCalledOnce());

    view.rerender(<RoleSwitcher activeRole="planner" onSwitch={vi.fn()} onReset={onReset} />);
    fireEvent.click(screen.getByRole('button', { name: /当前视角：计划员/ }));
    expect(screen.queryByText('重置演示数据')).not.toBeInTheDocument();
  });

  it('does not expose demo reset when the current administrator policy denies it', async () => {
    render(
      <RoleSwitcher activeRole="admin" canReset={false} onSwitch={vi.fn()} onReset={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /当前视角：系统管理员/ }));
    expect(screen.queryByText('重置演示数据')).not.toBeInTheDocument();
  });

  it('builds the reset actor from the selected administrator role', () => {
    expect(actorForRole('admin')).toEqual({
      userId: 'u-admin',
      name: '系统管理员',
      role: 'admin',
    });
  });

  it('does not persist or commit a role that has no enabled principal', async () => {
    const setItem = vi.fn();
    const setInitialState = vi.fn();
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository: {
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.sales),
        getRolePrincipal: vi.fn().mockResolvedValue(undefined),
      } as unknown as EnterpriseRepository,
      storage: { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null, setItem },
      setInitialState,
      notify,
    });

    await expect(actions.switchRole('sales')).resolves.toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(setInitialState).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('销售经理暂无启用用户，无法切换');
  });

  it('resets through the replacement administrator and reloads the post-reset principal', async () => {
    const replacementAdmin = {
      actor: { userId: 'u-sales', name: '销售员', role: 'admin' as const },
      access: { role: 'admin' as const, actorId: 'u-sales', organizationId: 'ORG-01' },
    };
    const restoredAdmin = {
      actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' as const },
      access: { role: 'admin' as const, actorId: 'u-admin', organizationId: 'ORG-01' },
    };
    const getRolePrincipal = vi.fn()
      .mockResolvedValueOnce(replacementAdmin)
      .mockResolvedValueOnce(restoredAdmin);
    const reset = vi.fn().mockResolvedValue({
      success: true,
      message: '演示数据已重置',
      affectedIds: ['mock-database'],
      events: [],
    });
    let state: AppInitialState = {
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      currentPrincipal: replacementAdmin,
      dataRevision: 8,
    };
    const actions = createRoleSwitcherActions({
      repository: {
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.admin),
        getRolePrincipal,
        reset,
      } as unknown as EnterpriseRepository,
      storage: { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null, setItem: vi.fn() },
      setInitialState: async (update) => {
        state = typeof update === 'function' ? update(state) : update;
      },
      notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    });

    await expect(actions.reset('admin')).resolves.toBe(true);
    expect(reset).toHaveBeenCalledWith(replacementAdmin.actor);
    expect(state).toMatchObject({
      activeRole: 'admin',
      currentPrincipal: restoredAdmin,
      dataRevision: 9,
    });
  });

  it('persists a loaded policy and refreshes dashboard state after an administrator reset', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const plannerPolicy = { ...ROLE_POLICIES.planner, scope: 'self' as const };
    const getRolePolicy = vi.fn(async (role) =>
      role === 'planner' ? plannerPolicy : ROLE_POLICIES.admin,
    );
    const getRolePrincipal = vi.fn(async (role) => principalFor(role));
    const reset = vi.fn().mockResolvedValue({
      success: true,
      message: '演示数据已重置',
      affectedIds: ['mock-database'],
      events: [],
    });
    const repository = { getRolePolicy, getRolePrincipal, reset } as unknown as EnterpriseRepository;
    let state: AppInitialState = {
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      currentPrincipal: principalFor('admin'),
      dataRevision: 2,
    };
    const setInitialState = vi.fn(async (update) => {
      state = typeof update === 'function' ? update(state) : update;
    });
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository,
      storage,
      setInitialState,
      notify,
    });

    await actions.switchRole('planner');
    expect(values.get('hch-erp:active-role')).toBe('planner');
    expect(state).toEqual({
      activeRole: 'planner',
      currentPolicy: plannerPolicy,
      currentPrincipal: principalFor('planner'),
      dataRevision: 2,
    });

    await actions.reset('admin');
    expect(reset).toHaveBeenCalledWith(actorForRole('admin'));
    expect(state).toEqual({
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      currentPrincipal: principalFor('admin'),
      dataRevision: 3,
    });
    expect(notify.success).toHaveBeenCalledWith('演示数据已重置');
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('fails closed with a refreshed dashboard revision when reset succeeds but policy reload fails', async () => {
    const reset = vi.fn().mockResolvedValue({
      success: true,
      message: '演示数据已重置',
      affectedIds: ['mock-database'],
      events: [],
    });
    const repository = {
      reset,
      getRolePolicy: vi.fn().mockRejectedValue(new Error('policy unavailable')),
      getRolePrincipal: vi.fn().mockResolvedValue(principalFor('admin')),
    } as unknown as EnterpriseRepository;
    let state: AppInitialState = {
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      dataRevision: 6,
    };
    const setInitialState = vi.fn(async (update) => {
      state = typeof update === 'function' ? update(state) : update;
    });
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository,
      storage: { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null, setItem: vi.fn() },
      setInitialState,
      notify,
    });

    await actions.reset('admin');

    expect(state).toMatchObject({
      activeRole: 'admin',
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 7,
    });
    expect(state.initializationError).toMatch(/权限策略/);
    expect(notify.warning).toHaveBeenCalledWith('演示数据已重置，但权限策略刷新失败');
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('rolls back the persisted role when initial-state commit fails', async () => {
    const values = new Map([[ROLE_STORAGE_KEY, 'admin']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository: {
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
        getRolePrincipal: vi.fn().mockResolvedValue(principalFor('planner')),
      } as unknown as EnterpriseRepository,
      storage,
      setInitialState: vi.fn().mockRejectedValue(new Error('state unavailable')),
      notify,
    });

    await expect(actions.switchRole('planner')).resolves.toBe(false);
    expect(values.get(ROLE_STORAGE_KEY)).toBe('admin');
    expect(notify.error).toHaveBeenCalledWith('角色视角切换失败，请重试');
  });

  it('does not commit UI state or report success when role persistence fails', async () => {
    const setInitialState = vi.fn();
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository: {
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
        getRolePrincipal: vi.fn().mockResolvedValue(principalFor('planner')),
      } as unknown as EnterpriseRepository,
      storage: {
        getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null,
        setItem: () => {
          throw new Error('storage unavailable');
        },
      },
      setInitialState,
      notify,
    });

    await expect(actions.switchRole('planner')).resolves.toBe(false);
    expect(setInitialState).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('角色视角切换失败，请重试');
  });

  it('suppresses an older role failure after a newer role policy wins', async () => {
    const planner = Promise.withResolvers<typeof ROLE_POLICIES.planner>();
    const warehouse = Promise.withResolvers<typeof ROLE_POLICIES.warehouse>();
    const getRolePolicy = vi.fn((role) =>
      role === 'planner' ? planner.promise : warehouse.promise,
    );
    let state: AppInitialState = {
      activeRole: 'admin',
      currentPolicy: ROLE_POLICIES.admin,
      dataRevision: 0,
    };
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository: {
        getRolePolicy,
        getRolePrincipal: vi.fn(async (role) => principalFor(role)),
      } as unknown as EnterpriseRepository,
      storage: { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null, setItem: vi.fn() },
      setInitialState: async (update) => {
        state = typeof update === 'function' ? update(state) : update;
      },
      notify,
    });

    const older = actions.switchRole('planner');
    const newer = actions.switchRole('warehouse');
    warehouse.resolve(ROLE_POLICIES.warehouse);
    await expect(newer).resolves.toBe(true);
    planner.reject(new Error('old planner request failed'));
    await expect(older).resolves.toBe(false);

    expect(state.activeRole).toBe('warehouse');
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('warns when reset persisted but the UI state cannot refresh', async () => {
    const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const actions = createRoleSwitcherActions({
      repository: {
        reset: vi.fn().mockResolvedValue({
          success: true,
          message: '演示数据已重置',
          affectedIds: ['mock-database'],
          events: [],
        }),
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.admin),
        getRolePrincipal: vi.fn().mockResolvedValue(principalFor('admin')),
      } as unknown as EnterpriseRepository,
      storage: { getItem: (key: string) => key === ROLE_STORAGE_KEY ? 'admin' : null, setItem: vi.fn() },
      setInitialState: vi.fn().mockRejectedValue(new Error('state unavailable')),
      notify,
    });

    await actions.reset('admin');

    expect(notify.warning).toHaveBeenCalledWith('演示数据已重置，但界面刷新失败');
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('keeps the connected switcher non-privileged while policy state is loading or failed', async () => {
    initialStateModel.current = {
      initialState: undefined,
      loading: true,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
      setInitialState: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<RoleSwitcher />);
    expect(screen.getByText('权限策略加载中')).toBeInTheDocument();
    expect(screen.queryByText(/系统管理员/)).not.toBeInTheDocument();

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
      setInitialState: vi.fn().mockResolvedValue(undefined),
    };
    view.rerender(<RoleSwitcher />);
    expect(screen.getByText('权限策略加载失败')).toBeInTheDocument();
    expect(screen.queryByText(/当前视角：系统管理员/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
