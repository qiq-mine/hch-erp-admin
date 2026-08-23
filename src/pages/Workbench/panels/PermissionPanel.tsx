import { Button, Card, Checkbox, Input, Space, Timeline, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLE_POLICIES, type RolePolicy } from '@/config/roles';
import type { BusinessRecord, DataScope, DomainKey, PermissionAction, RoleKey } from '@/domain/types';
import type { PanelProps } from '../index';
import { useWorkbenchStyles } from '../styles';

const ROLES = Object.keys(ROLE_POLICIES) as RoleKey[];
const DOMAINS: ReadonlyArray<[DomainKey, string]> = [
  ['dashboard', '经营驾驶舱'], ['sales', '销售与订单'], ['planning', '生产计划'],
  ['manufacturing', '制造执行'], ['warehouse', '仓储物流'], ['finance', '业财核算'],
  ['integration', '系统集成'], ['security', '系统与权限'],
];
const ACTIONS: PermissionAction[] = [
  'read', 'supervise', 'create-intent', 'submit', 'audit', 'push-order', 'special-approve',
  'change-order', 'schedule', 'release-batch', 'start-task', 'complete-task', 'scan-report',
  'package', 'stock-in', 'stock-out', 'transfer', 'retry-sync', 'reconcile', 'allocate-cost',
  'approve-cost', 'permission-change', 'user-admin', 'role-admin', 'reset-demo',
];
const ACTION_LABELS: Partial<Record<PermissionAction, string>> = {
  read: '读取', schedule: '排程', 'release-batch': '投放批次', 'permission-change': '变更授权',
  'stock-in': '入库', 'stock-out': '出库', transfer: '调拨', 'allocate-cost': '成本分摊',
  'approve-cost': '成本审批', 'retry-sync': '同步重试', 'scan-report': '扫码报工', package: '生成包件',
};
const SCOPES: Array<{ value: DataScope; label: string }> = [
  { value: 'group', label: '集团' }, { value: 'organization', label: '组织' },
  { value: 'factory', label: '工厂' }, { value: 'warehouse', label: '仓库' },
  { value: 'self', label: '本人' },
];

const clonePolicy = (policy: RolePolicy): RolePolicy => ({
  label: policy.label,
  domains: [...policy.domains],
  actions: [...policy.actions],
  scope: policy.scope,
});

const isPolicy = (value: unknown): value is RolePolicy => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RolePolicy>;
  return typeof candidate.label === 'string' && candidate.label.trim().length > 0 &&
    Array.isArray(candidate.domains) && candidate.domains.every((domain) => DOMAINS.some(([key]) => key === domain)) &&
    Array.isArray(candidate.actions) && candidate.actions.every((action) => action === '*' || ACTIONS.includes(action as PermissionAction)) &&
    SCOPES.some(({ value: scope }) => scope === candidate.scope);
};

const permissionAuditRows = (rows: BusinessRecord[]) => rows.filter((row) =>
  row && typeof row.id === 'string' && typeof row.title === 'string' &&
  typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) &&
  row.data && typeof row.data === 'object' && row.data.action === 'permission-change',
);

export function PermissionPanel({
  busy,
  canPerform,
  data,
  onPerform,
  onPolicyChanged,
  repository,
  role,
}: PanelProps) {
  const { styles } = useWorkbenchStyles();
  const policies = useMemo(() => {
    const supplied = data.policies && typeof data.policies === 'object'
      ? data.policies as Partial<Record<RoleKey, unknown>>
      : {};
    return Object.fromEntries(ROLES.map((key) => [
      key,
      isPolicy(supplied[key]) ? supplied[key] : ROLE_POLICIES[key],
    ])) as Record<RoleKey, RolePolicy>;
  }, [data.policies]);
  const [selectedRole, setSelectedRole] = useState<RoleKey>('planner');
  const [draft, setDraft] = useState<RolePolicy>(() => clonePolicy(policies.planner ?? ROLE_POLICIES.planner));
  const [events, setEvents] = useState<BusinessRecord[]>([]);
  const [auditError, setAuditError] = useState<string>();
  const [assignableScopes, setAssignableScopes] = useState<DataScope[]>([]);
  const [scopeError, setScopeError] = useState<string>();
  const activeRef = useRef(true);
  const auditEpochRef = useRef(0);
  const scopeEpochRef = useRef(0);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      auditEpochRef.current += 1;
      scopeEpochRef.current += 1;
    };
  }, []);
  const loadEvents = useCallback(async () => {
    const epoch = ++auditEpochRef.current;
    setAuditError(undefined);
    try {
      const principal = await repository.getRolePrincipal(role);
      if (!activeRef.current || epoch !== auditEpochRef.current) return;
      if (!principal) throw new Error('当前角色暂无启用用户');
      const result = await repository.listRecords('audits', {
        access: principal.access,
        auditCategory: 'security',
        auditOrder: 'latest',
        page: 1,
        pageSize: 6,
      });
      if (!activeRef.current || epoch !== auditEpochRef.current) return;
      const unique = new Map<string, BusinessRecord>();
      for (const row of permissionAuditRows(result.data)) unique.set(row.id, row);
      setEvents([...unique.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
        .slice(0, 6));
    } catch (cause) {
      if (!activeRef.current || epoch !== auditEpochRef.current) return;
      setEvents([]);
      setAuditError(cause instanceof Error ? cause.message : '授权审计加载失败');
    }
  }, [repository, role]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const epoch = ++scopeEpochRef.current;
    setAssignableScopes([]);
    setScopeError(undefined);
    void repository.getAssignableScopes(selectedRole).then(
      (scopes) => {
        if (!activeRef.current || epoch !== scopeEpochRef.current) return;
        setAssignableScopes(scopes);
      },
      () => {
        if (!activeRef.current || epoch !== scopeEpochRef.current) return;
        setScopeError('可授权数据范围加载失败');
      },
    );
    return () => { scopeEpochRef.current += 1; };
  }, [repository, selectedRole]);
  useEffect(() => {
    setDraft(clonePolicy(policies[selectedRole] ?? ROLE_POLICIES[selectedRole]));
  }, [policies, selectedRole]);

  const toggleDomain = (domain: DomainKey, checked: boolean) => setDraft((current) => ({
    ...current,
    domains: checked ? [...current.domains, domain] : current.domains.filter((item) => item !== domain),
  }));
  const toggleAction = (action: PermissionAction, checked: boolean) => setDraft((current) => {
    const currentActions = current.actions.includes('*') ? ACTIONS : current.actions as PermissionAction[];
    return {
      ...current,
      actions: checked
        ? [...new Set([...currentActions, action])]
        : currentActions.filter((item) => item !== action),
    };
  });
  const save = async () => {
    if (!assignableScopes.includes(draft.scope)) {
      setScopeError('所选数据范围会导致目标角色没有可信用户');
      return;
    }
    const policy = clonePolicy(draft);
    const result = await onPerform(
      'permission-change',
      [selectedRole],
      { policy },
      onPolicyChanged,
    );
    if (!result?.success) return;
    await loadEvents();
  };
  const actionSet = useMemo(() => new Set(draft.actions.includes('*') ? ACTIONS : draft.actions), [draft.actions]);
  return (
    <section aria-label="权限矩阵" className={styles.panel}>
      <Card className={styles.queue} title="角色">
        <select aria-label="角色" onChange={(event) => setSelectedRole(event.target.value as RoleKey)} value={selectedRole}>
          {ROLES.map((role) => <option key={role} value={role}>{ROLE_POLICIES[role].label}</option>)}
        </select>
        {auditError ? <Typography.Text type="danger">{auditError}</Typography.Text> : null}
        {events.map((event) => <div key={event.id}>{event.title}</div>)}
      </Card>
      <Card className={styles.workspace} title="菜单与数据范围">
        <Space orientation="vertical">
          <Input aria-label="策略名称" onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} value={draft.label} />
          <Typography.Text strong>菜单域</Typography.Text>
          {DOMAINS.map(([domain, label]) => (
            <Checkbox checked={draft.domains.includes(domain)} key={domain} onChange={(event) => toggleDomain(domain, event.target.checked)}>{label}</Checkbox>
          ))}
          <select
            aria-label="数据范围"
            onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value as DataScope }))}
            value={draft.scope}
          >
            {SCOPES.map((scope) => (
              <option disabled={!assignableScopes.includes(scope.value)} key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </select>
          {scopeError ? <Typography.Text type="danger">{scopeError}</Typography.Text> : null}
        </Space>
      </Card>
      <Card className={styles.context} title="操作权限与审计">
        <Space orientation="vertical">
          {ACTIONS.map((action) => (
            <Checkbox checked={actionSet.has(action)} key={action} onChange={(event) => toggleAction(action, event.target.checked)}>{ACTION_LABELS[action] ?? action}</Checkbox>
          ))}
          {canPerform('permission-change') ? <Button disabled={busy || !draft.label.trim() || !assignableScopes.includes(draft.scope)} loading={busy} onClick={() => void save()} type="primary">保存授权</Button> : null}
          <Timeline items={events.map((event) => ({ content: `${event.updatedAt} ${event.title}` }))} />
        </Space>
      </Card>
    </section>
  );
}
