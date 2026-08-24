import { PageContainer } from '@ant-design/pro-components';
import { useLocation, useModel } from '@umijs/max';
import { Alert, Button, Result, Spin } from 'antd';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInitialState } from '@/app';
import { resolvePage, type PageDefinition } from '@/config/pageCatalog';
import { canAccess, FAIL_CLOSED_POLICY, ROLE_POLICIES, type RolePolicy } from '@/config/roles';
import type { OperationResult, PermissionAction, RoleKey } from '@/domain/types';
import {
  enterpriseRepository,
  type EnterpriseRepository,
  type PerformCommand,
  type WorkbenchModule,
} from '@/services/enterprise';
import { AllocationPanel } from './panels/AllocationPanel';
import { AnalysisPanel } from './panels/AnalysisPanel';
import { BatchPanel } from './panels/BatchPanel';
import { CapacityPanel } from './panels/CapacityPanel';
import { IntegrationMonitorPanel } from './panels/IntegrationMonitorPanel';
import { MappingPanel } from './panels/MappingPanel';
import { PackagingPanel } from './panels/PackagingPanel';
import { PermissionPanel } from './panels/PermissionPanel';
import { ScanPanel } from './panels/ScanPanel';
import { SchedulePanel } from './panels/SchedulePanel';
import { StockPanel } from './panels/StockPanel';
import { useWorkbenchStyles } from './styles';

export interface PanelProps {
  busy: boolean;
  canPerform: (action: PermissionAction) => boolean;
  data: Record<string, unknown>;
  onPerform: (
    action: PermissionAction,
    ids: string[],
    payload?: Record<string, unknown>,
    afterSuccess?: () => Promise<void>,
  ) => Promise<OperationResult | undefined>;
  onPolicyChanged?: () => Promise<void>;
  page: PageDefinition;
  repository: EnterpriseRepository;
  role: RoleKey;
}

export interface WorkbenchProps {
  dataRevision?: number;
  onPolicyChanged?: () => Promise<void>;
  pathname: string;
  policy?: RolePolicy;
  repository?: EnterpriseRepository;
  role: RoleKey;
}

const PANELS: Record<WorkbenchModule, ComponentType<PanelProps>> = {
  schedule: SchedulePanel,
  batches: BatchPanel,
  capacity: CapacityPanel,
  reporting: ScanPanel,
  packaging: PackagingPanel,
  stock: StockPanel,
  allocation: AllocationPanel,
  analysis: AnalysisPanel,
  'integration-monitor': IntegrationMonitorPanel,
  'sync-mappings': MappingPanel,
  permissions: PermissionPanel,
};

const repositoryIds = new WeakMap<object, number>();
let nextRepositoryId = 1;

function repositoryId(repository: EnterpriseRepository) {
  const known = repositoryIds.get(repository);
  if (known !== undefined) return known;
  const id = nextRepositoryId++;
  repositoryIds.set(repository, id);
  return id;
}

function policySignature(policy: RolePolicy) {
  return JSON.stringify({
    label: policy.label,
    domains: [...policy.domains],
    actions: [...policy.actions],
    scope: policy.scope,
  });
}

function workbenchPage(pathname: string) {
  const page = resolvePage(pathname);
  if (page.kind !== 'workbench') throw new Error(`ERP page is not a workbench: ${pathname}`);
  return page as PageDefinition & { module: WorkbenchModule };
}

export function Workbench(props: WorkbenchProps) {
  const repository = props.repository ?? enterpriseRepository;
  const policy = props.policy ?? ROLE_POLICIES[props.role];
  const identity = [
    repositoryId(repository),
    props.pathname,
    props.role,
    policySignature(policy),
    props.dataRevision ?? 0,
  ].join(':');
  return <WorkbenchIdentity key={identity} {...props} policy={policy} repository={repository} />;
}

function WorkbenchIdentity({
  onPolicyChanged,
  pathname,
  policy,
  repository = enterpriseRepository,
  role,
}: WorkbenchProps) {
  if (!policy) throw new Error('Workbench policy is required');
  const page = workbenchPage(pathname);
  const Panel = PANELS[page.module];
  const { styles } = useWorkbenchStyles();
  const epochRef = useRef(0);
  const activeRef = useRef(true);
  const operationLockRef = useRef(false);
  const [data, setData] = useState<Record<string, unknown>>({ records: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [principalUnavailable, setPrincipalUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<OperationResult>();

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const epoch = ++epochRef.current;
    setLoading(true);
    setLoadError(undefined);
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current || epoch !== epochRef.current) return;
      if (!principal) {
        setPrincipalUnavailable(true);
        setLoading(false);
        return;
      }
      const snapshot = await repository.getWorkbench(page.module, principal.access);
      if (!activeRef.current || epoch !== epochRef.current) return;
      setData(snapshot);
      setPrincipalUnavailable(false);
      setLoading(false);
    } catch (cause) {
      if (!activeRef.current || epoch !== epochRef.current) return;
      setLoadError(cause instanceof Error ? cause.message : '工作台数据加载失败');
      setLoading(false);
    }
  }, [page.module, repository, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const canPerform = useCallback((action: PermissionAction) => canAccess(
    role,
    page.domain,
    action,
    { [role]: policy },
  ) && page.actions.includes(action), [page, policy, role]);

  const perform = useCallback(async (
    action: PermissionAction,
    ids: string[],
    payload?: Record<string, unknown>,
    afterSuccess?: () => Promise<void>,
  ) => {
    if (operationLockRef.current || !canPerform(action)) return undefined;
    operationLockRef.current = true;
    setBusy(true);
    const operationEpoch = ++epochRef.current;
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current || operationEpoch !== epochRef.current) return undefined;
      if (!principal) {
        setPrincipalUnavailable(true);
        setFeedback(undefined);
        return undefined;
      }
      const command: PerformCommand = {
        module: page.module,
        action,
        ids,
        actor: principal.actor,
        access: principal.access,
        ...(payload ? { payload } : {}),
      };
      const result = await repository.perform(command);
      if (!activeRef.current || operationEpoch !== epochRef.current) return undefined;
      if (result.success && afterSuccess) {
        try {
          await afterSuccess();
        } catch (cause) {
          if (!activeRef.current || operationEpoch !== epochRef.current) return undefined;
          const refreshFailure: OperationResult = {
            success: false,
            message: cause instanceof Error ? cause.message : '授权上下文刷新失败',
            affectedIds: result.affectedIds,
            events: result.events,
          };
          setFeedback(refreshFailure);
          return refreshFailure;
        }
        if (!activeRef.current || operationEpoch !== epochRef.current) return undefined;
      }
      setFeedback(result);
      if (result.success) await load();
      return result;
    } catch (cause) {
      if (!activeRef.current || operationEpoch !== epochRef.current) return undefined;
      const result: OperationResult = {
        success: false,
        message: cause instanceof Error ? cause.message : '操作失败，请重试',
        affectedIds: [],
        events: [],
      };
      setFeedback(result);
      return result;
    } finally {
      operationLockRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }, [canPerform, load, page.module, repository, role]);

  if (!canAccess(role, page.domain, 'read', { [role]: policy })) {
    return <PageContainer title={page.title}><Result status="403" title="无权访问此业务页面" /></PageContainer>;
  }
  if (principalUnavailable) {
    return (
      <PageContainer title={page.title}>
        <Result
          extra={<Button aria-label="重试" onClick={() => void load()}>重试</Button>}
          status="warning"
          title="当前角色暂无启用用户"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer content={page.description} title={page.title}>
      {feedback ? (
        <Alert
          className={styles.feedback}
          title={feedback.message}
          showIcon
          type={feedback.success ? 'success' : 'warning'}
        />
      ) : null}
      {loadError ? (
        <Result
          extra={<Button aria-label="重试" onClick={() => void load()}>重试</Button>}
          status="error"
          title="工作台数据加载失败"
          subTitle={loadError}
        />
      ) : (
        <>
          {loading ? <Button aria-label="重试" onClick={() => void load()}>重试</Button> : null}
          <Spin description="工作台数据加载中" spinning={loading}>
          <div className={styles.workbench}>
            <Panel
              busy={busy}
              canPerform={canPerform}
              data={data}
              onPerform={perform}
              onPolicyChanged={onPolicyChanged}
              page={page}
              repository={repository}
              role={role}
            />
          </div>
          </Spin>
        </>
      )}
    </PageContainer>
  );
}

interface InitialStateWorkbenchModel {
  initialState?: AppInitialState;
  loading: boolean;
  error?: Error;
  refresh: () => Promise<void>;
  setInitialState: (
    state: AppInitialState | ((previous?: AppInitialState) => AppInitialState),
  ) => Promise<void>;
}

export interface RefreshActiveAuthorizationOptions {
  repository: Pick<EnterpriseRepository, 'getRolePolicy' | 'getRolePrincipal'>;
  requestedRole: RoleKey;
  isCurrent: () => boolean;
  setInitialState: InitialStateWorkbenchModel['setInitialState'];
}

export async function refreshActiveAuthorization({
  repository,
  requestedRole,
  isCurrent,
  setInitialState,
}: RefreshActiveAuthorizationOptions): Promise<void> {
  const [currentPolicy, currentPrincipal] = await Promise.all([
    repository.getRolePolicy(requestedRole),
    repository.getRolePrincipal(requestedRole),
  ]);
  if (!isCurrent()) throw new Error('授权上下文已变化');
  if (!currentPrincipal) throw new Error(`${ROLE_POLICIES[requestedRole].label}暂无启用用户`);
  let applied = false;
  await setInitialState((previous) => {
    if (!previous || previous.activeRole !== requestedRole || !isCurrent()) {
      return previous ?? {
        currentPolicy: FAIL_CLOSED_POLICY,
        dataRevision: 0,
        initializationError: '授权上下文已变化',
      };
    }
    applied = true;
    return {
      ...previous,
      currentPolicy,
      currentPrincipal,
      dataRevision: previous.dataRevision + 1,
      initializationError: undefined,
    };
  });
  if (!applied) throw new Error('授权上下文已变化');
}

export default function ConnectedWorkbench({
  repository = enterpriseRepository,
}: { repository?: EnterpriseRepository }) {
  const location = useLocation();
  const model = useModel('@@initialState') as InitialStateWorkbenchModel;
  const state = model.initialState;
  const connectedIdentityRef = useRef('');
  const connectedEpochRef = useRef(0);
  const connectedIdentity = `${repositoryId(repository)}:${state?.activeRole ?? 'unavailable'}`;
  if (connectedIdentityRef.current !== connectedIdentity) {
    connectedIdentityRef.current = connectedIdentity;
    connectedEpochRef.current += 1;
  }
  if (model.loading) {
    return <PageContainer><Result status="info" title="权限策略加载中" /></PageContainer>;
  }
  if (
    state?.activeRole && state.currentPolicy && !state.currentPrincipal &&
    (!state.initializationError || state.initializationError.includes('暂无启用用户'))
  ) {
    return (
      <PageContainer>
        <Result extra={<Button onClick={() => model.refresh()}>重试</Button>} status="warning" title="当前角色暂无启用用户" />
      </PageContainer>
    );
  }
  if (
    model.error || !state?.activeRole || !state.currentPolicy ||
    !state.currentPrincipal || state.initializationError
  ) {
    return (
      <PageContainer>
        <Result extra={<Button onClick={() => model.refresh()}>重试</Button>} status="warning" title="权限策略加载失败" />
      </PageContainer>
    );
  }
  const role = state.activeRole;
  const refreshPolicy = async () => {
    const epoch = connectedEpochRef.current;
    await refreshActiveAuthorization({
      repository,
      requestedRole: role,
      isCurrent: () => connectedEpochRef.current === epoch &&
        connectedIdentityRef.current === `${repositoryId(repository)}:${role}`,
      setInitialState: model.setInitialState,
    });
  };
  return (
    <Workbench
      dataRevision={state.dataRevision}
      onPolicyChanged={refreshPolicy}
      pathname={location.pathname}
      policy={state.currentPolicy}
      repository={repository}
      role={role}
    />
  );
}
