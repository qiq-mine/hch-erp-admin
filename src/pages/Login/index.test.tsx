import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInitialState } from '@/app';
import { FAIL_CLOSED_POLICY, ROLE_POLICIES } from '@/config/roles';
import type { RoleKey } from '@/domain/types';
import { createMemoryStorage } from '@/services/enterprise/memoryStorage';
import type { EnterpriseRepository } from '@/services/enterprise/types';
import ConnectedLogin, { Login, createLoginAuthorizationCoordinator } from './index';

const umiLogin = vi.hoisted(() => ({ push: vi.fn(), setInitialState: vi.fn() }));

vi.mock('@umijs/max', () => ({
  history: { push: umiLogin.push },
  useModel: () => ({ setInitialState: umiLogin.setInitialState }),
}));

beforeEach(() => {
  umiLogin.push.mockReset();
  umiLogin.setInitialState.mockReset();
});

describe('Login', () => {
  it('renders exact product identity, Mock disclosure, and all seven role views', async () => {
    render(<Login onLogin={() => undefined} />);
    expect(screen.getByRole('heading', { name: '现代离散制造 ERP 系统' })).toBeInTheDocument();
    expect(screen.getByText(/演示数据均为 Mock/)).toBeInTheDocument();
    expect(screen.getByText('系统管理员')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: '登录视角' }));
    expect(await screen.findAllByRole('option')).toHaveLength(7);
  });

  it('submits the selected role and reports a trusted-login failure without navigating', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('当前角色暂无启用用户'));
    render(<Login onLogin={onLogin} />);
    await userEvent.click(screen.getByRole('combobox', { name: '登录视角' }));
    await userEvent.click(await screen.findByRole('option', { name: '计划员' }));
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(onLogin).toHaveBeenCalledWith('planner');
    expect(await screen.findByText('当前角色暂无启用用户')).toBeInTheDocument();
  });
});

describe('connected login authorization', () => {
  it('keeps the default connected coordinator stable across rerender while principal loading', async () => {
    const principal = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['getRolePrincipal']>>>();
    const repository = {
      getRolePrincipal: vi.fn().mockReturnValue(principal.promise),
      getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.admin),
    } as unknown as EnterpriseRepository;
    const storage = createMemoryStorage();
    let state = { dataRevision: 0 } as AppInitialState;
    umiLogin.setInitialState.mockImplementation(async (updater) => { state = updater(state); });
    const view = render(<ConnectedLogin repository={repository} storage={storage} />);
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    view.rerender(<ConnectedLogin repository={repository} storage={storage} />);
    principal.resolve({
      actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
    });

    await waitFor(() => expect(umiLogin.push).toHaveBeenCalledWith('/dashboard'));
    expect(storage.getItem('hch-erp:active-role')).toBe('admin');
    expect(state).toMatchObject({ activeRole: 'admin', currentPrincipal: expect.any(Object) });
  });

  it('loads a trusted principal and current policy before persisting and navigating', async () => {
    const repository = {
      getRolePrincipal: vi.fn().mockResolvedValue({
        actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
        access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
      }),
      getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
    } as unknown as EnterpriseRepository;
    const storage = createMemoryStorage();
    let state = { dataRevision: 4 };
    const setInitialState = vi.fn(async (updater) => { state = updater(state); });
    const navigate = vi.fn();
    const coordinator = createLoginAuthorizationCoordinator({
      repository, storage, setInitialState, navigate,
    });

    await coordinator.login('planner');

    expect(repository.getRolePrincipal).toHaveBeenCalledWith('planner');
    expect(repository.getRolePolicy).toHaveBeenCalledWith('planner');
    expect(setInitialState).toHaveBeenLastCalledWith(expect.any(Function));
    expect(state).toMatchObject({
      activeRole: 'planner', currentPolicy: ROLE_POLICIES.planner,
      currentPrincipal: expect.objectContaining({ actor: expect.objectContaining({ userId: 'u-planner' }) }),
      dataRevision: 6, initializationError: undefined,
    });
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('fails closed without persistence/navigation and prevents an older identity from committing', async () => {
    const oldPrincipal = Promise.withResolvers<Awaited<ReturnType<EnterpriseRepository['getRolePrincipal']>>>();
    const repository = {
      getRolePrincipal: vi.fn((role) => role === 'sales'
        ? oldPrincipal.promise
        : Promise.resolve(undefined)),
      getRolePolicy: vi.fn((role: RoleKey) => Promise.resolve(ROLE_POLICIES[role])),
    } as unknown as EnterpriseRepository;
    const storage = createMemoryStorage();
    let state = { dataRevision: 0 } as AppInitialState;
    const setInitialState = vi.fn(async (updater) => { state = updater(state); });
    const navigate = vi.fn();
    const coordinator = createLoginAuthorizationCoordinator({
      repository, storage, setInitialState, navigate,
    });
    const oldLogin = coordinator.login('sales');
    await expect(coordinator.login('planner')).rejects.toThrow('当前角色暂无启用用户');
    oldPrincipal.resolve({
      actor: { userId: 'u-sales', name: '销售经理', role: 'sales' },
      access: { role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01' },
    });
    await oldLogin;

    await waitFor(() => expect(navigate).not.toHaveBeenCalled());
    expect(state).toMatchObject({ activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY });
    expect(storage.getItem('hch-erp:active-role')).toBeNull();
  });

  it('rolls back an old commit already inside an async setter when a newer login fails', async () => {
    const gate = Promise.withResolvers<void>();
    const storage = createMemoryStorage({ 'hch-erp:active-role': 'admin' });
    let state = {
      activeRole: 'admin' as RoleKey, currentPolicy: ROLE_POLICIES.admin,
      currentPrincipal: { actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' as const }, access: { role: 'admin' as const, actorId: 'u-admin', organizationId: 'ORG-01' } },
      dataRevision: 1,
    };
    const setInitialState = vi.fn(async (updater) => {
      const next = updater(state);
      state = next;
      if (next.activeRole === 'sales') await gate.promise;
    });
    const repository = {
      getRolePrincipal: vi.fn(async (role: RoleKey) => role === 'planner' ? undefined : ({
        actor: { userId: 'u-sales', name: '销售经理', role: 'sales' },
        access: { role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01' },
      })),
      getRolePolicy: vi.fn(async (role: RoleKey) => ROLE_POLICIES[role]),
    } as unknown as EnterpriseRepository;
    const navigate = vi.fn();
    const coordinator = createLoginAuthorizationCoordinator({ repository, storage, setInitialState, navigate });

    const old = coordinator.login('sales');
    await waitFor(() => expect(state.activeRole).toBe('sales'));
    await expect(coordinator.login('planner')).rejects.toThrow('当前角色暂无启用用户');
    gate.resolve();
    await old;

    expect(storage.getItem('hch-erp:active-role')).toBe('admin');
    expect(state).toMatchObject({ activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY, currentPrincipal: undefined });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('publishes the newer failed generation while an obsolete setter never resolves', async () => {
    const never = new Promise<void>(() => undefined);
    let state = { dataRevision: 0 } as AppInitialState;
    const setInitialState = vi.fn(async (updater) => {
      const next = updater(state);
      state = next;
      if (next.activeRole === 'sales') await never;
    });
    const coordinator = createLoginAuthorizationCoordinator({
      repository: {
        getRolePrincipal: vi.fn(async (role: RoleKey) => role === 'planner' ? undefined : ({
          actor: { userId: 'u-sales', name: '销售经理', role: 'sales' },
          access: { role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01' },
        })),
        getRolePolicy: vi.fn(async (role: RoleKey) => ROLE_POLICIES[role]),
      } as unknown as EnterpriseRepository,
      storage: createMemoryStorage({ 'hch-erp:active-role': 'admin' }),
      setInitialState,
      navigate: vi.fn(),
    });

    void coordinator.login('sales');
    await waitFor(() => expect(state.activeRole).toBe('sales'));
    await expect(coordinator.login('planner')).rejects.toThrow('当前角色暂无启用用户');
    expect(state).toMatchObject({
      activeRole: undefined, authorizationGeneration: 2,
      currentPolicy: FAIL_CLOSED_POLICY, currentPrincipal: undefined,
    });
  });

  it('completes a newer success while the same coordinator old success setter never resolves', async () => {
    const oldSetterGate = Promise.withResolvers<void>();
    let heldOldUpdater: ((state?: AppInitialState) => AppInitialState) | undefined;
    let setterCalls = 0;
    let state = { dataRevision: 0 } as AppInitialState;
    const setInitialState = vi.fn(async (updater) => {
      setterCalls += 1;
      if (setterCalls === 2) {
        heldOldUpdater = updater;
        await oldSetterGate.promise;
        return;
      }
      state = updater(state);
    });
    const repository = {
      getRolePrincipal: vi.fn(async (role: RoleKey) => ({
        actor: {
          userId: role === 'sales' ? 'u-sales' : 'u-admin',
          name: role === 'sales' ? '销售经理' : '系统管理员',
          role,
        },
        access: {
          role,
          actorId: role === 'sales' ? 'u-sales' : 'u-admin',
          organizationId: 'ORG-01',
        },
      })),
      getRolePolicy: vi.fn(async (role: RoleKey) => ROLE_POLICIES[role]),
    } as unknown as EnterpriseRepository;
    const storage = createMemoryStorage();
    const navigate = vi.fn();
    const coordinator = createLoginAuthorizationCoordinator({
      repository, storage, setInitialState, navigate,
    });

    const oldLogin = coordinator.login('sales');
    await waitFor(() => expect(heldOldUpdater).toBeTypeOf('function'));
    const newLogin = coordinator.login('admin');
    try {
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
      await newLogin;
      expect(storage.getItem('hch-erp:active-role')).toBe('admin');
      expect(state).toMatchObject({ activeRole: 'admin', currentPrincipal: expect.any(Object) });

      const beforeOldUpdater = state;
      state = heldOldUpdater?.(state) ?? state;
      expect(state).toEqual(beforeOldUpdater);
    } finally {
      oldSetterGate.resolve();
      await oldLogin;
      await newLogin;
    }
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)(
    'does not let an old coordinator updater overwrite a new coordinator %s',
    async (outcome) => {
      const gate = Promise.withResolvers<void>();
      let capturedOld: ((state?: AppInitialState) => AppInitialState) | undefined;
      const oldSetter = vi.fn(async (updater) => {
        if (!capturedOld) return;
        capturedOld = updater;
        await gate.promise;
      });
      let oldCalls = 0;
      oldSetter.mockImplementation(async (updater) => {
        oldCalls += 1;
        if (oldCalls === 1) return;
        capturedOld = updater;
        await gate.promise;
      });
      const oldCoordinator = createLoginAuthorizationCoordinator({
        repository: {
          getRolePrincipal: vi.fn().mockResolvedValue({
            actor: { userId: 'u-sales', name: '销售经理', role: 'sales' },
            access: { role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01' },
          }),
          getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.sales),
        } as unknown as EnterpriseRepository,
        storage: createMemoryStorage(), setInitialState: oldSetter, navigate: vi.fn(),
      });
      void oldCoordinator.login('sales');
      await waitFor(() => expect(capturedOld).toBeTypeOf('function'));

      let state = { dataRevision: 0 } as AppInitialState;
      const newCoordinator = createLoginAuthorizationCoordinator({
        repository: {
          getRolePrincipal: vi.fn().mockResolvedValue(outcome === 'success' ? {
            actor: { userId: 'u-admin', name: '系统管理员', role: 'admin' },
            access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
          } : undefined),
          getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.admin),
        } as unknown as EnterpriseRepository,
        storage: createMemoryStorage(),
        setInitialState: async (updater) => { state = updater(state); },
        navigate: vi.fn(),
      });
      if (outcome === 'success') await newCoordinator.login('admin');
      else await expect(newCoordinator.login('admin')).rejects.toThrow();
      const before = state;
      state = capturedOld?.(state) ?? state;
      expect(state).toEqual(before);
      gate.resolve();
    },
  );

  it('restores storage and publishes fail-closed state when the initial-state setter rejects', async () => {
    const storage = createMemoryStorage({ 'hch-erp:active-role': 'admin' });
    let state = { dataRevision: 2 } as AppInitialState;
    const setInitialState = vi.fn(async (updater) => {
      state = updater(state);
      if (state.activeRole === 'planner') throw new Error('state unavailable');
    });
    const repository = {
      getRolePrincipal: vi.fn().mockResolvedValue({
        actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
        access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
      }),
      getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
    } as unknown as EnterpriseRepository;
    const coordinator = createLoginAuthorizationCoordinator({
      repository, storage, setInitialState, navigate: vi.fn(),
    });

    await expect(coordinator.login('planner')).rejects.toThrow('state unavailable');
    expect(storage.getItem('hch-erp:active-role')).toBe('admin');
    expect(state).toMatchObject({ activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY, currentPrincipal: undefined });
  });

  it('fails closed when role storage set throws', async () => {
    let state = { dataRevision: 0 };
    const storage = {
      getItem: (key: string) => key === 'hch-erp:active-role' ? 'admin' : null,
      setItem: () => { throw new Error('storage set failed'); },
      removeItem: () => { throw new Error('storage remove failed'); },
    };
    const setInitialState = vi.fn(async (updater) => { state = updater(state); });
    const coordinator = createLoginAuthorizationCoordinator({
      repository: {
        getRolePrincipal: vi.fn().mockResolvedValue({
          actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
          access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
        }),
        getRolePolicy: vi.fn().mockResolvedValue(ROLE_POLICIES.planner),
      } as unknown as EnterpriseRepository,
      storage, setInitialState, navigate: vi.fn(),
    });

    await expect(coordinator.login('planner')).rejects.toThrow('storage set failed');
    expect(state).toMatchObject({ activeRole: undefined, currentPolicy: FAIL_CLOSED_POLICY, currentPrincipal: undefined });
  });
});
