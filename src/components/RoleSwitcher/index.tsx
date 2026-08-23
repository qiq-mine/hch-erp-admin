import { DownOutlined, ReloadOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { Button, Dropdown, message, Space, type MenuProps } from 'antd';
import { useMemo, useState } from 'react';
import type { AppInitialState } from '@/app';
import {
  canAccess,
  FAIL_CLOSED_POLICY,
  ROLE_POLICIES,
  type RolePolicy,
} from '@/config/roles';
import type { Actor, OperationResult, RoleKey } from '@/domain/types';
import {
  createRoleModel,
  getBrowserRoleStorage,
  type RoleStorage,
} from '@/models/role';
import {
  enterpriseRepository,
  type EnterpriseRepository,
} from '@/services/enterprise';

const ROLE_KEYS = Object.keys(ROLE_POLICIES) as RoleKey[];
const RESET_KEY = '__reset_demo__';

export const actorForRole = (role: RoleKey): Actor => ({
  userId: `u-${role}`,
  name: ROLE_POLICIES[role].label,
  role,
});

interface RoleSwitcherViewProps {
  activeRole: RoleKey;
  canReset: boolean;
  compact?: boolean;
  onSwitch: (role: RoleKey) => void | Promise<void>;
  onReset?: () => void | Promise<void>;
}

function RoleSwitcherView({ activeRole, canReset, compact, onSwitch, onReset }: RoleSwitcherViewProps) {
  const [pending, setPending] = useState(false);
  const items: MenuProps['items'] = [
    ...ROLE_KEYS.map((role) => ({
      key: role,
      label: ROLE_POLICIES[role].label,
      disabled: role === activeRole,
    })),
    ...(canReset && onReset
      ? [
          { type: 'divider' as const },
          { key: RESET_KEY, label: '重置演示数据', icon: <ReloadOutlined /> },
        ]
      : []),
  ];

  const handleClick: MenuProps['onClick'] = async ({ key }) => {
    setPending(true);
    try {
      if (key === RESET_KEY) await onReset?.();
      else await onSwitch(key as RoleKey);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dropdown menu={{ items, onClick: handleClick }} trigger={['click']}>
      <Button
        aria-label={`当前视角：${ROLE_POLICIES[activeRole].label}`}
        loading={pending}
        title={`当前视角：${ROLE_POLICIES[activeRole].label}`}
        type="text"
      >
        {compact
          ? <UserSwitchOutlined />
          : <>当前视角：{ROLE_POLICIES[activeRole].label} <DownOutlined /></>}
      </Button>
    </Dropdown>
  );
}

export interface RoleSwitcherProps {
  activeRole?: RoleKey;
  canReset?: boolean;
  compact?: boolean;
  onSwitch?: (role: RoleKey) => void | Promise<void>;
  onReset?: () => void | Promise<void>;
}

interface InitialStateModel {
  initialState?: AppInitialState;
  loading: boolean;
  error?: Error;
  refresh: () => Promise<void>;
  setInitialState: (
    state: AppInitialState | ((previous?: AppInitialState) => AppInitialState),
  ) => Promise<void>;
}

interface RoleSwitcherNotifier {
  success: (content: string) => void;
  warning: (content: string) => void;
  error: (content: string) => void;
}

export interface RoleSwitcherActionDependencies {
  repository: Pick<EnterpriseRepository, 'getRolePolicy' | 'getRolePrincipal' | 'reset'>;
  storage: RoleStorage;
  setInitialState: InitialStateModel['setInitialState'];
  notify: RoleSwitcherNotifier;
}

export function createRoleSwitcherActions({
  repository,
  storage,
  setInitialState,
  notify,
}: RoleSwitcherActionDependencies) {
  let switchSequence = 0;

  return {
    async switchRole(role: RoleKey) {
      const sequence = ++switchSequence;
      let previousRole: RoleKey | undefined;
      let rolePersisted = false;
      try {
        const [currentPolicy, currentPrincipal] = await Promise.all([
          repository.getRolePolicy(role),
          repository.getRolePrincipal(role),
        ]);
        if (sequence !== switchSequence) return false;
        if (!currentPrincipal) {
          notify.error(`${ROLE_POLICIES[role].label}暂无启用用户，无法切换`);
          return false;
        }
        const roleModel = createRoleModel(storage);
        previousRole = roleModel.getActiveRole();
        roleModel.switchRole(role);
        rolePersisted = previousRole !== role;
        await setInitialState((previous) => ({
          activeRole: role,
          currentPolicy,
          currentPrincipal,
          dataRevision: previous?.dataRevision ?? 0,
        }));
        return true;
      } catch {
        if (sequence !== switchSequence) return false;
        if (rolePersisted && previousRole) {
          try {
            createRoleModel(storage).switchRole(previousRole);
          } catch {
            // The switch still reports failure; callers must not assume persistence succeeded.
          }
        }
        notify.error('角色视角切换失败，请重试');
        return false;
      }
    },

    async reset(activeRole: RoleKey) {
      let result: OperationResult;
      try {
        const adminPrincipal = await repository.getRolePrincipal('admin');
        if (!adminPrincipal) {
          notify.error('系统管理员暂无启用用户，无法重置');
          return false;
        }
        result = await repository.reset(adminPrincipal.actor);
      } catch {
        notify.error('演示数据重置失败，请重试');
        return false;
      }
      if (!result.success) {
        notify.error(result.message);
        return false;
      }

      let currentPolicy: RolePolicy;
      let currentPrincipal: AppInitialState['currentPrincipal'];
      try {
        [currentPolicy, currentPrincipal] = await Promise.all([
          repository.getRolePolicy(activeRole),
          repository.getRolePrincipal(activeRole),
        ]);
        if (!currentPrincipal) throw new Error('role principal unavailable');
      } catch {
        try {
          await setInitialState((previous) => ({
            activeRole,
            currentPolicy: FAIL_CLOSED_POLICY,
            currentPrincipal: undefined,
            dataRevision: (previous?.dataRevision ?? 0) + 1,
            initializationError: '权限策略或角色主体刷新失败',
          }));
        } catch {
          notify.warning('演示数据已重置，但界面刷新失败');
          return false;
        }
        notify.warning('演示数据已重置，但权限策略刷新失败');
        return false;
      }

      try {
        await setInitialState((previous) => ({
          activeRole,
          currentPolicy,
          currentPrincipal,
          dataRevision: (previous?.dataRevision ?? 0) + 1,
        }));
      } catch {
        notify.warning('演示数据已重置，但界面刷新失败');
        return false;
      }
      notify.success('演示数据已重置');
      return true;
    },
  };
}

interface RecoveryViewProps {
  loading: boolean;
  onRetry: () => void | Promise<void>;
  onSwitch: (role: RoleKey) => void | Promise<void>;
}

function RolePolicyRecovery({ loading, onRetry, onSwitch }: RecoveryViewProps) {
  const [pending, setPending] = useState(false);
  const items: MenuProps['items'] = ROLE_KEYS.map((role) => ({
    key: role,
    label: ROLE_POLICIES[role].label,
  }));

  if (loading) return <Button loading>权限策略加载中</Button>;

  return (
    <Space>
      <Dropdown
        menu={{
          items,
          onClick: async ({ key }) => {
            setPending(true);
            try {
              await onSwitch(key as RoleKey);
            } finally {
              setPending(false);
            }
          },
        }}
        trigger={['click']}
      >
        <Button danger loading={pending}>权限策略加载失败 <DownOutlined /></Button>
      </Dropdown>
      <Button onClick={() => onRetry()}>重试</Button>
    </Space>
  );
}

function ConnectedRoleSwitcher({
  compact,
  repository = enterpriseRepository,
}: { compact?: boolean; repository?: EnterpriseRepository }) {
  const model = useModel('@@initialState') as InitialStateModel;
  const actions = useMemo(
    () => createRoleSwitcherActions({
      repository,
      storage: getBrowserRoleStorage(),
      setInitialState: model.setInitialState,
      notify: message,
    }),
    [model.setInitialState, repository],
  );
  const policyReady = Boolean(
    model.initialState?.activeRole &&
    model.initialState.currentPolicy &&
    model.initialState.currentPrincipal &&
    !model.initialState.initializationError &&
    !model.error,
  );

  if (model.loading || !policyReady) {
    return (
      <RolePolicyRecovery
        loading={model.loading}
        onRetry={model.refresh}
        onSwitch={async (role) => {
          const switched = await actions.switchRole(role);
          if (switched && model.error) await model.refresh();
        }}
      />
    );
  }

  const activeRole = model.initialState?.activeRole as RoleKey;
  const currentPolicy = model.initialState?.currentPolicy as AppInitialState['currentPolicy'];
  const canReset = activeRole === 'admin' && canAccess(
    activeRole,
    'security',
    'reset-demo',
    { [activeRole]: currentPolicy },
  );

  return (
    <RoleSwitcherView
      activeRole={activeRole}
      canReset={canReset}
      compact={compact}
      onReset={canReset
        ? async () => {
            await actions.reset(activeRole);
          }
        : undefined}
      onSwitch={async (role) => {
        await actions.switchRole(role);
      }}
    />
  );
}

export function RoleSwitcher({
  activeRole,
  canReset = false,
  compact,
  onSwitch,
  onReset,
}: RoleSwitcherProps) {
  if (activeRole && onSwitch) {
    return (
      <RoleSwitcherView
        activeRole={activeRole}
        canReset={canReset}
        compact={compact}
        onReset={onReset}
        onSwitch={onSwitch}
      />
    );
  }
  return <ConnectedRoleSwitcher compact={compact} />;
}
