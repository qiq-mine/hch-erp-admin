import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import { useLocation, useModel } from '@umijs/max';
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Result,
  Space,
  Typography,
} from 'antd';
import type { Key } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInitialState } from '@/app';
import { BusinessStatusTag } from '@/components/BusinessStatusTag';
import {
  OperationConfirm,
  operationLabel,
  type OperationAction,
} from '@/components/OperationConfirm';
import { RecordDetailDrawer } from '@/components/RecordDetailDrawer';
import { resolvePage, type PageDefinition } from '@/config/pageCatalog';
import {
  canAccess,
  ROLE_POLICIES,
  type RolePolicy,
} from '@/config/roles';
import type {
  Actor,
  BillStatus,
  BusinessRecord,
  PermissionAction,
  RoleKey,
} from '@/domain/types';
import {
  enterpriseRepository,
  type AccessContext,
  type EnterpriseRepository,
  type ListQuery,
  type RecordModule,
} from '@/services/enterprise';
import { useRecordsStyles } from './styles';

const STATUS_OPTIONS: Record<BillStatus, { text: string }> = {
  draft: { text: '草稿' },
  submitted: { text: '已提交' },
  audited: { text: '已审核' },
  executing: { text: '执行中' },
  completed: { text: '已完成' },
  'validation-failed': { text: '校验失败' },
  'pending-special-approval': { text: '待特批' },
  'sync-failed': { text: '同步失败' },
  cancelled: { text: '已取消' },
};

const ROLE_USER_IDS: Record<RoleKey, string> = {
  general: 'u-general',
  sales: 'u-sales',
  planner: 'u-planner',
  production: 'u-production',
  warehouse: 'u-wh',
  finance: 'u-finance',
  admin: 'u-admin',
};

const BATCH_CAPABLE_ACTIONS = new Set<OperationAction>([
  'submit',
  'audit',
  'push-order',
  'special-approve',
  'retry-sync',
  'start-task',
  'complete-task',
  'reconcile',
]);

export function actorForRole(role: RoleKey): Actor {
  return {
    userId: ROLE_USER_IDS[role],
    name: ROLE_POLICIES[role].label,
    role,
  };
}

export function toListQuery(
  params: Record<string, unknown>,
  access: AccessContext,
  auditCategory?: ListQuery['auditCategory'],
): ListQuery {
  const text = (value: unknown) => typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
  return {
    keyword: text(params.keyword),
    status: text(params.status),
    organizationId: text(params.organizationId),
    page: typeof params.current === 'number' ? params.current : 1,
    pageSize: typeof params.pageSize === 'number' ? params.pageSize : 10,
    access,
    ...(auditCategory ? {
      auditCategory,
      auditActor: text(params.auditActor),
      auditAction: text(params.auditAction),
      auditResult: text(params.auditResult) as ListQuery['auditResult'],
      auditDate: text(params.auditDate),
    } : {}),
  };
}

function actionAllowedByState(
  module: PageDefinition['module'],
  action: OperationAction,
  status: BillStatus,
): boolean {
  if (module === 'intent-orders') {
    return (
      (action === 'submit' && status === 'draft') ||
      (action === 'audit' && status === 'submitted') ||
      (action === 'special-approve' && status === 'pending-special-approval') ||
      (action === 'push-order' && status === 'audited')
    );
  }
  if (module === 'credit-approvals') {
    return action === 'special-approve' && status === 'submitted';
  }
  if (module === 'sync-jobs') return action === 'retry-sync' && status === 'sync-failed';
  if (module === 'production-tasks') {
    return (
      (action === 'start-task' && status === 'audited') ||
      (action === 'complete-task' && status === 'executing')
    );
  }
  if (module === 'reconciliations') return action === 'reconcile' && status === 'submitted';
  if (module === 'cost-collections') return action === 'approve-cost' && status === 'audited';
  if (module === 'order-changes') {
    return action === 'change-order' || (action === 'audit' && status === 'submitted');
  }
  if (module === 'users') return action === 'user-admin';
  if (module === 'roles') return action === 'role-admin';
  return false;
}

function availableActions(
  page: PageDefinition,
  record: BusinessRecord,
  role: RoleKey,
  policy: RolePolicy,
): OperationAction[] {
  const overrides = { [role]: policy };
  return page.actions.filter((action): action is OperationAction =>
    action !== 'read' &&
    canAccess(role, page.domain, action as PermissionAction, overrides) &&
    actionAllowedByState(page.module, action, record.status),
  );
}

interface PendingOperation {
  records: BusinessRecord[];
  action: OperationAction;
}

interface ManagementOperation {
  action: 'user-admin' | 'role-admin';
  record: BusinessRecord;
}

interface ManagementValues {
  enabled?: boolean;
  members?: number;
  responsibility?: string;
  role?: RoleKey;
}

interface ChangeOrderValues {
  deliveryDate: string;
  quantityDelta?: number;
  reason: string;
}

function assertRecordPage(
  page: PageDefinition,
): asserts page is PageDefinition & { kind: 'records'; module: RecordModule } {
  if (page.kind !== 'records') {
    throw new Error(`ERP page is not a record list: ${page.path}`);
  }
}

export interface RecordsProps {
  dataRevision?: number;
  repository?: EnterpriseRepository;
  role: RoleKey;
  pathname: string;
  policy?: RolePolicy;
}

export interface LatestRequestCoordinator<T> {
  invalidate(): void;
  run(
    load: () => Promise<T>,
    hooks?: { onLatest?: (value: T) => void; onStart?: () => void },
  ): Promise<T>;
}

export function createLatestRequestCoordinator<T>(): LatestRequestCoordinator<T> {
  let epoch = 0;
  let latestPromise: Promise<T> | undefined;
  return {
    invalidate() {
      epoch += 1;
      latestPromise = undefined;
    },
    run(load, hooks = {}) {
      const requestEpoch = ++epoch;
      hooks.onStart?.();
      let publicPromise: Promise<T>;
      const forwardLatest = () => {
        const latest = latestPromise;
        return latest && latest !== publicPromise ? latest : undefined;
      };
      publicPromise = Promise.resolve().then(load).then(
        (value) => {
          if (requestEpoch !== epoch) return forwardLatest() ?? value;
          hooks.onLatest?.(value);
          return value;
        },
        (error: unknown) => {
          if (requestEpoch !== epoch) {
            const latest = forwardLatest();
            if (latest) return latest;
          }
          return Promise.reject(error);
        },
      );
      latestPromise = publicPromise;
      return publicPromise;
    },
  };
}

const repositoryIds = new WeakMap<object, number>();
let nextRepositoryId = 1;

function repositoryId(repository: EnterpriseRepository): number {
  const existing = repositoryIds.get(repository);
  if (existing !== undefined) return existing;
  const identity = nextRepositoryId;
  nextRepositoryId += 1;
  repositoryIds.set(repository, identity);
  return identity;
}

function policySignature(policy: RolePolicy): string {
  return JSON.stringify({
    label: policy.label,
    domains: [...policy.domains],
    actions: [...policy.actions],
    scope: policy.scope,
  });
}

export function Records(props: RecordsProps) {
  const repository = props.repository ?? enterpriseRepository;
  const page = resolvePage(props.pathname);
  assertRecordPage(page);
  const effectivePolicy = props.policy ?? ROLE_POLICIES[props.role];
  const identity = [
    repositoryId(repository),
    props.pathname,
    props.role,
    policySignature(effectivePolicy),
    props.dataRevision ?? 0,
  ].join(':');
  return (
    <RecordsIdentity
      key={identity}
      {...props}
      policy={effectivePolicy}
      repository={repository}
    />
  );
}

interface CreateIntentValues {
  number: string;
  title: string;
  customer: string;
  amount: number;
  organizationId: string;
  creditSufficient: boolean;
}

function RecordsIdentity({
  repository = enterpriseRepository,
  role,
  pathname,
  policy,
}: RecordsProps) {
  const page = resolvePage(pathname);
  assertRecordPage(page);
  const effectivePolicy = policy ?? ROLE_POLICIES[role];
  const overrides = { [role]: effectivePolicy };
  const { styles } = useRecordsStyles();
  const actionRef = useRef<ActionType>(null);
  const requestCoordinator = useMemo(() => createLatestRequestCoordinator<{
      error?: Error;
      principalGeneration: number;
      principalUnavailable?: boolean;
      result: { data: BusinessRecord[]; total: number; success: boolean };
    }>(), []);
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  const principalGenerationRef = useRef(0);
  const [messageApi, messageContext] = message.useMessage();
  const [createForm] = Form.useForm<CreateIntentValues>();
  const [managementForm] = Form.useForm<ManagementValues>();
  const [changeOrderForm] = Form.useForm<ChangeOrderValues>();
  const [selected, setSelected] = useState<BusinessRecord>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [selectedRows, setSelectedRows] = useState<BusinessRecord[]>([]);
  const [pending, setPending] = useState<PendingOperation>();
  const [management, setManagement] = useState<ManagementOperation>();
  const [changeOrderRecord, setChangeOrderRecord] = useState<BusinessRecord>();
  const [operationLoading, setOperationLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<Error>();
  const [principalUnavailable, setPrincipalUnavailable] = useState(false);

  const markPrincipalUnavailable = () => {
    principalGenerationRef.current += 1;
    requestCoordinator.invalidate();
    setQueryLoading(false);
    setQueryError(undefined);
    setPrincipalUnavailable(true);
  };

  const canRead = canAccess(role, page.domain, 'read', overrides);
  const recordModule = page.module;
  const auditCategory = recordModule === 'audits' &&
    (page.domain === 'integration' || page.domain === 'security')
    ? page.domain
    : undefined;
  const hasBatchSelection = page.actions.some((action) =>
    action !== 'read' && BATCH_CAPABLE_ACTIONS.has(action) &&
    canAccess(role, page.domain, action as PermissionAction, overrides),
  );
  const canCreateIntent = recordModule === 'intent-orders' &&
    page.actions.includes('create-intent') &&
    canAccess(role, page.domain, 'create-intent', overrides);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const requestRecords = (params: Record<string, unknown>) =>
    requestCoordinator.run(
      async () => {
        const principalGeneration = principalGenerationRef.current;
        try {
          const principal = await repository.getRolePrincipal(role);
          if (!principal) {
            return {
              principalGeneration,
              principalUnavailable: true,
              result: { data: [], total: 0, success: true },
            };
          }
          return {
            principalGeneration,
            result: await repository.listRecords(
              recordModule,
              toListQuery(params, principal.access, auditCategory),
            ),
          };
        } catch (cause) {
          return {
            error: cause instanceof Error ? cause : new Error('业务数据加载失败'),
            principalGeneration,
            result: { data: [], total: 0, success: false },
          };
        }
      },
      {
        onStart: () => {
          if (!activeRef.current) return;
          setSelectedRowKeys([]);
          setSelectedRows([]);
          setPending((current) => current && current.records.length > 1 ? undefined : current);
          setQueryLoading(true);
          setQueryError(undefined);
        },
        onLatest: (outcome) => {
          if (!activeRef.current) return;
          if (outcome.principalGeneration !== principalGenerationRef.current) return;
          if (outcome.principalUnavailable) {
            markPrincipalUnavailable();
            return;
          }
          setQueryError(outcome.error);
          setPrincipalUnavailable(false);
          setQueryLoading(false);
        },
      },
    ).then((outcome) => outcome.result);

  const runAction = async (records: BusinessRecord[], action: OperationAction) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setOperationLoading(true);
    const principalGeneration = principalGenerationRef.current;
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current) return;
      if (principalGeneration !== principalGenerationRef.current) return;
      if (!principal) {
        markPrincipalUnavailable();
        messageApi.warning('当前角色暂无启用用户');
        return;
      }
      const result = await repository.perform({
        module: page.module,
        action,
        ids: records.map((record) => record.number),
        actor: principal.actor,
        access: principal.access,
      });
      if (!activeRef.current) return;
      if (principalGeneration !== principalGenerationRef.current) return;
      if (result.success) messageApi.success(result.message);
      else messageApi.warning(result.message);
      actionRef.current?.reload();
      if (result.success && action === 'retry-sync' && records.length === 1) {
        const currentPrincipal = await repository.getRolePrincipal(role);
        if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
        if (!currentPrincipal) {
          markPrincipalUnavailable();
          return;
        }
        const refreshed = await repository.listRecords('sync-jobs', {
          access: currentPrincipal.access,
          keyword: records[0].number,
          page: 1,
          pageSize: 1,
        });
        if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
        setSelected(refreshed.data.find((record) => record.number === records[0].number));
      } else if (result.success) {
        setSelected((current) => {
          if (!current || !records.some((record) => record.id === current.id)) return current;
          return undefined;
        });
      }
      setSelectedRowKeys([]);
      setSelectedRows([]);
    } catch (cause) {
      if (activeRef.current) {
        messageApi.error(cause instanceof Error ? cause.message : '操作失败，请重试');
      }
    } finally {
      inFlightRef.current = false;
      if (activeRef.current) {
        setOperationLoading(false);
        setPending(undefined);
      }
    }
  };

  const openOperation = useCallback((record: BusinessRecord, action: OperationAction) => {
    if (action === 'change-order') {
      const changes = record.data.changes;
      const prior = changes && typeof changes === 'object' && !Array.isArray(changes)
        ? changes as Record<string, unknown>
        : {};
      changeOrderForm.setFieldsValue({
        deliveryDate: typeof prior.deliveryDate === 'string' ? prior.deliveryDate : '',
        quantityDelta: typeof prior.quantityDelta === 'number' ? prior.quantityDelta : undefined,
        reason: typeof prior.reason === 'string' ? prior.reason : '',
      });
      setChangeOrderRecord(record);
      return;
    }
    if (action === 'user-admin' || action === 'role-admin') {
      managementForm.setFieldsValue(action === 'user-admin'
        ? { enabled: record.data.enabled === true, role: record.data.role as RoleKey }
        : {
            members: typeof record.data.members === 'number' ? record.data.members : 0,
            responsibility: typeof record.data.responsibility === 'string'
              ? record.data.responsibility
              : '',
          });
      setManagement({ action, record });
      return;
    }
    setPending({ records: [record], action });
  }, [changeOrderForm, managementForm]);

  const submitChangeOrder = async (values: ChangeOrderValues) => {
    if (!changeOrderRecord || inFlightRef.current) return;
    inFlightRef.current = true;
    setOperationLoading(true);
    const principalGeneration = principalGenerationRef.current;
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
      if (!principal) {
        markPrincipalUnavailable();
        messageApi.warning('当前角色暂无启用用户');
        return;
      }
      const result = await repository.perform({
        module: 'order-changes',
        action: 'change-order',
        ids: [changeOrderRecord.number],
        actor: principal.actor,
        access: principal.access,
        payload: {
          changes: {
            deliveryDate: values.deliveryDate.trim(),
            ...(values.quantityDelta === undefined ? {} : { quantityDelta: values.quantityDelta }),
            reason: values.reason.trim(),
          },
        },
      });
      if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
      if (!result.success) {
        messageApi.warning(result.message);
        return;
      }
      messageApi.success(result.message);
      setChangeOrderRecord(undefined);
      setSelected(undefined);
      changeOrderForm.resetFields();
      actionRef.current?.reload();
    } catch (cause) {
      if (activeRef.current) {
        messageApi.error(cause instanceof Error ? cause.message : '订单变更保存失败');
      }
    } finally {
      inFlightRef.current = false;
      if (activeRef.current) setOperationLoading(false);
    }
  };

  const submitManagement = async (values: ManagementValues) => {
    if (!management || inFlightRef.current) return;
    inFlightRef.current = true;
    setOperationLoading(true);
    const principalGeneration = principalGenerationRef.current;
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
      if (!principal) {
        markPrincipalUnavailable();
        messageApi.warning('当前角色暂无启用用户');
        return;
      }
      const payload = management.action === 'user-admin'
        ? { enabled: values.enabled, role: values.role }
        : { members: values.members, responsibility: values.responsibility };
      const result = await repository.perform({
        module: management.action === 'user-admin' ? 'users' : 'roles',
        action: management.action,
        ids: [management.record.number],
        actor: principal.actor,
        access: principal.access,
        payload,
      });
      if (!activeRef.current || principalGeneration !== principalGenerationRef.current) return;
      if (!result.success) {
        messageApi.warning(result.message);
        return;
      }
      messageApi.success(result.message);
      setManagement(undefined);
      setSelected(undefined);
      managementForm.resetFields();
      actionRef.current?.reload();
    } catch (cause) {
      if (activeRef.current) {
        messageApi.error(cause instanceof Error ? cause.message : '管理操作失败');
      }
    } finally {
      inFlightRef.current = false;
      if (activeRef.current) setOperationLoading(false);
    }
  };

  const createIntent = async (values: CreateIntentValues) => {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreateLoading(true);
    const principalGeneration = principalGenerationRef.current;
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current) return;
      if (principalGeneration !== principalGenerationRef.current) return;
      if (!principal) {
        markPrincipalUnavailable();
        messageApi.warning('当前角色暂无启用用户');
        return;
      }
      const result = await repository.perform({
        module: 'intent-orders',
        action: 'create-intent',
        ids: [],
        actor: principal.actor,
        access: principal.access,
        payload: { ...values },
      });
      if (!activeRef.current) return;
      if (!result.success) {
        messageApi.warning(result.message);
        return;
      }
      messageApi.success(result.message);
      setCreateOpen(false);
      createForm.resetFields();
      actionRef.current?.reload();
    } catch (cause) {
      if (activeRef.current) {
        messageApi.error(cause instanceof Error ? cause.message : '新建订购意向失败');
      }
    } finally {
      createInFlightRef.current = false;
      if (activeRef.current) setCreateLoading(false);
    }
  };

  const commonBatchActions = useMemo(() => {
    if (selectedRows.length === 0) return [];
    return page.actions.filter((action): action is OperationAction =>
      action !== 'read' && BATCH_CAPABLE_ACTIONS.has(action) &&
      selectedRows.every((record) =>
        availableActions(page, record, role, effectivePolicy).includes(action),
      ),
    );
  }, [effectivePolicy, page, role, selectedRows]);

  const columns = useMemo<ProColumns<BusinessRecord>[]>(() => [
    {
      dataIndex: 'keyword',
      fieldProps: { placeholder: '客户或单据号' },
      hideInTable: true,
      title: '客户或单据号',
    },
    {
      dataIndex: 'status',
      fieldProps: { placeholder: '业务状态' },
      hideInTable: true,
      title: '业务状态',
      valueEnum: STATUS_OPTIONS,
      valueType: 'select',
    },
    {
      dataIndex: 'organizationId',
      fieldProps: { placeholder: '组织编码' },
      hideInTable: true,
      title: '组织编码',
    },
    ...(auditCategory ? [
      { dataIndex: 'auditActor', hideInTable: true, title: '审计操作人' },
      {
        dataIndex: 'auditAction', fieldProps: { placeholder: '如 permission-change' },
        hideInTable: true, title: '操作类型',
      },
      {
        dataIndex: 'auditResult', fieldProps: { placeholder: 'success / failed' },
        hideInTable: true, title: '执行结果',
      },
      {
        dataIndex: 'auditDate', fieldProps: { placeholder: 'YYYY-MM-DD' },
        hideInTable: true, title: '发生日期',
      },
    ] : []),
    {
      dataIndex: 'number',
      hideInSearch: true,
      title: '单据编号',
      width: 170,
    },
    {
      dataIndex: 'title',
      ellipsis: true,
      hideInSearch: true,
      title: '业务摘要',
    },
    {
      dataIndex: 'status',
      hideInSearch: true,
      key: 'status-display',
      render: (_, record) => <BusinessStatusTag status={record.status} />,
      title: '状态',
      width: 100,
    },
    {
      dataIndex: 'organizationId',
      hideInSearch: true,
      key: 'organization-display',
      title: '组织',
      width: 110,
    },
    {
      dataIndex: 'updatedAt',
      hideInSearch: true,
      title: '更新时间',
      valueType: 'dateTime',
      width: 170,
    },
    {
      hideInSearch: true,
      key: 'actions',
      render: (_, record) => (
        <Space onClick={(event) => event.stopPropagation()} size={4} wrap>
          {availableActions(page, record, role, effectivePolicy).map((action) => (
            <Button
              key={action}
              onClick={() => openOperation(record, action)}
              size="small"
              type="link"
            >
              {operationLabel(action)}
            </Button>
          ))}
        </Space>
      ),
      title: '操作',
      valueType: 'option',
      width: 220,
    },
  ], [auditCategory, effectivePolicy, openOperation, page, role]);

  if (!canRead) {
    return (
      <PageContainer title={page.title}>
        <Result status="403" title="无权访问此业务页面" />
      </PageContainer>
    );
  }

  if (principalUnavailable) {
    return (
      <PageContainer title={page.title}>
        <Result
          extra={<Button onClick={() => setPrincipalUnavailable(false)}>重新加载</Button>}
          status="warning"
          title="当前角色暂无启用用户"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer content={page.description} title={page.title}>
      {messageContext}
      {queryLoading ? (
        <div
          aria-label="业务数据加载中"
          className={styles.loadState}
          role="status"
        />
      ) : null}
      {queryError ? (
        <Result
          className={styles.errorPanel}
          extra={(
            <Button
              onClick={() => {
                setQueryError(undefined);
                actionRef.current?.reload();
              }}
            >
              重试
            </Button>
          )}
          status="error"
          title="业务数据加载失败"
        />
      ) : null}
      <div className={queryError ? styles.hiddenTable : styles.tableViewport}>
        <ProTable<BusinessRecord>
          actionRef={actionRef}
          columns={columns}
          onRow={(record) => ({
            className: styles.clickableRow,
            onClick: () => setSelected(record),
          })}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          request={requestRecords}
          rowKey="id"
          scroll={{ x: 900 }}
          rowSelection={hasBatchSelection
            ? {
                onChange: (keys, rows) => {
                  setSelectedRowKeys(keys);
                  setSelectedRows(rows);
                },
                selectedRowKeys,
              }
            : undefined}
          search={{
            defaultCollapsed: false,
            filterType: 'query',
            resetText: '重置',
            searchText: '查询',
            span: { xs: 24, sm: 12, md: 8, lg: 6, xl: 6, xxl: 6 },
          }}
          toolBarRender={() => [
            ...(canCreateIntent
              ? [(
                  <Button key="create-intent" onClick={() => setCreateOpen(true)} type="primary">
                    新建订购意向
                  </Button>
                )]
              : []),
            ...(selectedRows.length > 0 && commonBatchActions.length === 0
              ? [(
                  <Typography.Text key="no-common-batch-action" type="secondary">
                    所选记录没有可共同执行的操作
                  </Typography.Text>
                )]
              : commonBatchActions.map((action) => (
                  <Button
                    key={`batch-${action}`}
                    onClick={() => setPending({ records: selectedRows, action })}
                  >
                    {`批量${operationLabel(action)}`}
                  </Button>
                ))),
          ]}
        />
      </div>
      <RecordDetailDrawer
        actions={selected
          ? availableActions(page, selected, role, effectivePolicy)
          : []}
        onAction={openOperation}
        onClose={() => setSelected(undefined)}
        open={Boolean(selected)}
        record={selected}
      />
      <OperationConfirm
        action={pending?.action}
        affectedCount={pending?.records.length ?? 0}
        loading={operationLoading}
        onCancel={() => setPending(undefined)}
        onConfirm={() => pending && runAction(pending.records, pending.action)}
        open={Boolean(pending)}
      />
      <Modal
        cancelButtonProps={{ disabled: operationLoading }}
        cancelText="取消"
        confirmLoading={operationLoading}
        destroyOnHidden
        okText="保存变更"
        onCancel={() => {
          if (!operationLoading) setChangeOrderRecord(undefined);
        }}
        onOk={() => changeOrderForm.submit()}
        open={Boolean(changeOrderRecord)}
        title="订单变更"
      >
        <Form<ChangeOrderValues>
          form={changeOrderForm}
          layout="vertical"
          onFinish={submitChangeOrder}
        >
          <Form.Item label="变更原因" name="reason" rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="新交付日期" name="deliveryDate" rules={[
            { required: true, whitespace: true },
            {
              validator: async (_, value) => {
                if (!value) return;
                const parsed = new Date(`${value}T00:00:00.000Z`);
                const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                  Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
                if (!valid) throw new Error('请输入有效日期');
              },
            },
          ]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item label="数量调整" name="quantityDelta" rules={[
            { type: 'number', min: -1_000_000, max: 1_000_000 },
            { validator: async (_, value) => value === 0 ? Promise.reject(new Error('数量调整不能为零')) : undefined },
          ]}>
            <InputNumber max={1_000_000} min={-1_000_000} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        cancelButtonProps={{ disabled: operationLoading }}
        cancelText="取消"
        confirmLoading={operationLoading}
        destroyOnHidden
        okText={management?.action === 'user-admin' ? '保存用户' : '保存角色'}
        onCancel={() => {
          if (!operationLoading) setManagement(undefined);
        }}
        onOk={() => managementForm.submit()}
        open={Boolean(management)}
        title={management?.action === 'user-admin' ? '维护用户' : '维护角色'}
      >
        <Form<ManagementValues>
          form={managementForm}
          layout="vertical"
          onFinish={submitManagement}
        >
          {management?.action === 'user-admin' ? (
            <>
              <Form.Item label="角色" name="role" rules={[{ required: true }]}>
                <select aria-label="角色">
                  {(Object.keys(ROLE_POLICIES) as RoleKey[]).map((key) => (
                    <option key={key} value={key}>{ROLE_POLICIES[key].label}</option>
                  ))}
                </select>
              </Form.Item>
              <Form.Item name="enabled" valuePropName="checked">
                <Checkbox>启用账号</Checkbox>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item label="成员数" name="members" rules={[{ required: true, type: 'number', min: 0 }]}>
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="职责" name="responsibility" rules={[{ required: true, whitespace: true }]}>
                <Input />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <Modal
        cancelButtonProps={{ disabled: createLoading }}
        cancelText="取消"
        closable={!createLoading}
        confirmLoading={createLoading}
        keyboard={!createLoading}
        mask={{ closable: !createLoading }}
        okText="创建"
        onCancel={() => {
          if (!createLoading) setCreateOpen(false);
        }}
        onOk={() => createForm.submit()}
        open={createOpen}
        title="新建订购意向"
      >
        <Form<CreateIntentValues>
          form={createForm}
          initialValues={{ organizationId: 'ORG-01', creditSufficient: true }}
          layout="vertical"
          onFinish={createIntent}
        >
          <Form.Item label="单据编号" name="number" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="业务摘要" name="title" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="客户" name="customer" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true, type: 'number', min: 0 }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="组织" name="organizationId" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="信用额度充足" name="creditSufficient" valuePropName="checked">
            <Checkbox>可直接审核通过</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}

interface InitialStateRecordsModel {
  initialState?: AppInitialState;
  loading: boolean;
  error?: Error;
  refresh: () => Promise<void>;
}

export default function ConnectedRecords({
  repository = enterpriseRepository,
}: { repository?: EnterpriseRepository }) {
  const location = useLocation();
  const model = useModel('@@initialState') as InitialStateRecordsModel;
  if (model.loading) {
    return (
      <PageContainer>
        <Result status="info" title="权限策略加载中" />
      </PageContainer>
    );
  }
  if (
    model.initialState?.activeRole &&
    model.initialState.currentPolicy &&
    !model.initialState.currentPrincipal &&
    (!model.initialState.initializationError ||
      model.initialState.initializationError.includes('暂无启用用户'))
  ) {
    return (
      <PageContainer>
        <Result
          extra={<Button onClick={() => model.refresh()}>重试</Button>}
          status="warning"
          title="当前角色暂无启用用户"
        />
      </PageContainer>
    );
  }
  if (
    model.error ||
    !model.initialState?.activeRole ||
    !model.initialState.currentPolicy ||
    model.initialState.initializationError
  ) {
    return (
      <PageContainer>
        <Result
          extra={<Button onClick={() => model.refresh()}>重试</Button>}
          status="warning"
          title="权限策略加载失败"
        />
      </PageContainer>
    );
  }
  return (
    <Records
      dataRevision={model.initialState.dataRevision}
      pathname={location.pathname}
      policy={model.initialState.currentPolicy}
      repository={repository}
      role={model.initialState.activeRole}
    />
  );
}
