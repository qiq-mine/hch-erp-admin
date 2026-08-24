import { LoginForm, ProFormSelect, ProFormText } from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { Alert, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { AppInitialState } from '@/app';
import { PRODUCT_NAME } from '@/config/product';
import { FAIL_CLOSED_POLICY, ROLE_POLICIES } from '@/config/roles';
import type { RoleKey } from '@/domain/types';
import { commitStoredRole, getBrowserRoleStorage, type RoleStorage } from '@/models/role';
import {
  enterpriseRepository,
  type EnterpriseRepository,
} from '@/services/enterprise';

const ROLE_OPTIONS = (Object.keys(ROLE_POLICIES) as RoleKey[]).map((role) => ({
  label: ROLE_POLICIES[role].label,
  value: role,
}));

let nextLoginCoordinatorId = 1;
let currentLoginToken: string | undefined;
const defaultNavigate = (path: string) => history.push(path);

interface LoginValues {
  role: RoleKey;
  username: string;
}

export interface LoginProps {
  onLogin: (role: RoleKey) => unknown | Promise<unknown>;
}

export function Login({ onLogin }: LoginProps) {
  const [error, setError] = useState<string>();
  return (
    <main>
      <Typography.Title level={1}>{PRODUCT_NAME}</Typography.Title>
      <LoginForm<LoginValues>
        initialValues={{ role: 'admin', username: 'demo.admin' }}
        onFinish={async ({ role }) => {
          setError(undefined);
          try {
            await onLogin(role);
            return true;
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '登录验证失败');
            return false;
          }
        }}
        submitter={{ searchConfig: { submitText: '登录' } }}
      >
        <Typography.Paragraph>现代离散制造企业运营与业财协同平台</Typography.Paragraph>
        <Alert
          description="演示数据均为 Mock，不连接生产 K3、CRM、MES 或 WMS"
          showIcon
          title="Mock 演示环境"
          type="info"
        />
        {error ? <Alert showIcon title={error} type="error" /> : null}
        <ProFormText
          label="演示账号"
          name="username"
          rules={[{ required: true, whitespace: true }]}
        />
        <ProFormSelect
          fieldProps={{ virtual: false }}
          label="登录视角"
          name="role"
          options={ROLE_OPTIONS}
          rules={[{ required: true }]}
        />
      </LoginForm>
    </main>
  );
}

type InitialStateUpdater = (
  updater: (state?: AppInitialState) => AppInitialState,
) => unknown | Promise<unknown>;

export interface LoginAuthorizationCoordinator {
  invalidate(): void;
  login(role: RoleKey): Promise<void>;
}

export function createLoginAuthorizationCoordinator({
  navigate,
  repository,
  setInitialState,
  storage,
}: {
  navigate: (path: string) => void;
  repository: Pick<EnterpriseRepository, 'getRolePolicy' | 'getRolePrincipal'>;
  setInitialState: InitialStateUpdater;
  storage: RoleStorage;
}): LoginAuthorizationCoordinator {
  let epoch = 0;
  const coordinatorId = nextLoginCoordinatorId++;
  let ownedToken: string | undefined;
  const owns = (token: string) => currentLoginToken === token && ownedToken === token;
  const failClosedState = (
    state: AppInitialState | undefined,
    generation: number,
    token: string,
  ): AppInitialState => {
    if (!owns(token)) return state ?? {
      authorizationGeneration: generation,
      authorizationToken: token,
      currentPolicy: FAIL_CLOSED_POLICY,
      dataRevision: 0,
      initializationError: '登录授权提交失败',
    };
    return {
      ...(state ?? { dataRevision: 0 }),
      activeRole: undefined,
      authorizationGeneration: generation,
      authorizationToken: token,
      currentPolicy: FAIL_CLOSED_POLICY,
      currentPrincipal: undefined,
      dataRevision: (state?.dataRevision ?? 0) + 1,
      initializationError: '登录授权提交失败',
    };
  };
  const publishFailClosed = async (generation: number, token: string) => {
    try {
      await setInitialState((state) => failClosedState(state, generation, token));
    } catch {
      // The caller still receives the original commit error; no stale identity is navigated.
    }
  };
  return {
    invalidate() {
      epoch += 1;
      if (ownedToken && currentLoginToken === ownedToken) currentLoginToken = undefined;
      ownedToken = undefined;
    },
    async login(role) {
      const requestEpoch = ++epoch;
      const requestToken = `${coordinatorId}:${requestEpoch}`;
      ownedToken = requestToken;
      currentLoginToken = requestToken;
      void Promise.resolve(
        setInitialState((state) => failClosedState(state, requestEpoch, requestToken)),
      ).catch(() => undefined);
      const principal = await repository.getRolePrincipal(role);
      if (requestEpoch !== epoch || !owns(requestToken)) return;
      if (!principal) {
        await publishFailClosed(requestEpoch, requestToken);
        throw new Error('当前角色暂无启用用户');
      }
      const policy = await repository.getRolePolicy(role);
      if (requestEpoch !== epoch || !owns(requestToken)) return;

      let stateApplied = false;
      let failClosedPublished = false;
      try {
        if (requestEpoch !== epoch || !owns(requestToken)) return;
        await setInitialState((state) => {
          if (requestEpoch !== epoch || !owns(requestToken)) {
            return state ?? failClosedState(state, requestEpoch, requestToken);
          }
          stateApplied = true;
          return {
            ...(state ?? { currentPolicy: policy, dataRevision: 0 }),
            activeRole: role,
            authorizationGeneration: requestEpoch,
            authorizationToken: requestToken,
            currentPolicy: policy,
            currentPrincipal: principal,
            dataRevision: (state?.dataRevision ?? 0) + 1,
            initializationError: undefined,
          };
        });
        if (requestEpoch !== epoch || !owns(requestToken) || !stateApplied) {
          await publishFailClosed(requestEpoch, requestToken);
          return;
        }

        try {
          commitStoredRole(storage, role, requestEpoch);
        } catch (cause) {
          await publishFailClosed(requestEpoch, requestToken);
          failClosedPublished = true;
          throw cause;
        }
        navigate('/dashboard');
      } catch (cause) {
        if (!failClosedPublished) await publishFailClosed(requestEpoch, requestToken);
        throw cause;
      }
    },
  };
}

interface LoginInitialStateModel {
  setInitialState: InitialStateUpdater;
}

export default function ConnectedLogin({
  navigate = defaultNavigate,
  repository = enterpriseRepository,
  storage = getBrowserRoleStorage(),
}: {
  navigate?: (path: string) => void;
  repository?: EnterpriseRepository;
  storage?: RoleStorage;
}) {
  const model = useModel('@@initialState') as LoginInitialStateModel;
  const coordinator = useMemo(() => createLoginAuthorizationCoordinator({
    navigate,
    repository,
    setInitialState: model.setInitialState,
    storage,
  }), [model.setInitialState, navigate, repository, storage]);
  useEffect(() => () => coordinator.invalidate(), [coordinator]);
  return <Login onLogin={(role) => coordinator.login(role)} />;
}
