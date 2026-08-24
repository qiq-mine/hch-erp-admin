import {
  canAccess,
  filterByDataScope,
  hasRequiredDataScopeContext,
  ROLE_POLICIES,
  type RolePolicy,
} from '@/config/roles';
import { MOCK_STORAGE_KEY } from '@/config/product';
import { transitionBill } from '@/domain/billStateMachine';
import {
  validateBarcode,
  type BarcodeContext,
  type BarcodeStage,
} from '@/domain/barcodeValidation';
import { allocateByPhysicalWeight, type WeightItem } from '@/domain/costAllocation';
import { isPackageKittingData } from '@/domain/packageKitting';
import type {
  Actor,
  AuditEvent,
  AuditSourceModule,
  BillAction,
  BillStatus,
  BusinessRecord,
  DataScope,
  DomainKey,
  OperationResult,
  PermissionAction,
  RoleKey,
} from '@/domain/types';
import { createFixtureDatabase } from './fixtures';
import type { MockStorage } from './memoryStorage';
import type {
  AccessContext,
  DashboardData,
  EnterpriseRepository,
  ListQuery,
  ListResult,
  MockDatabase,
  PerformCommand,
  RecordModule,
  RolePrincipal,
  WorkbenchModule,
} from './types';

export interface MockRepositoryOptions {
  storage: MockStorage;
  delay?: () => Promise<void>;
  now?: () => string;
}

type CommandAction = BillAction | PermissionAction;
type IdRequirement = 'none' | 'one' | 'many';

interface BarcodeScope {
  organizationId: string;
  factoryId?: string;
  warehouseId?: string;
  ownerId?: string;
}

export interface ModuleRule {
  domain: DomainKey;
  actions: Partial<Record<CommandAction, IdRequirement>>;
}

const RECORD_MODULES = [
  'todos', 'alerts', 'intent-orders', 'sales-orders', 'order-changes',
  'credit-approvals', 'production-tasks', 'inbound', 'outbound', 'transfers',
  'reconciliations', 'cost-collections', 'sync-jobs', 'users', 'roles', 'audits',
] as const satisfies readonly RecordModule[];

const WORKBENCH_MODULES = [
  'schedule', 'batches', 'capacity', 'reporting', 'packaging', 'stock',
  'allocation', 'analysis', 'integration-monitor', 'sync-mappings', 'permissions',
] as const satisfies readonly WorkbenchModule[];

const DOMAIN_KEYS = [
  'dashboard', 'sales', 'planning', 'manufacturing', 'warehouse', 'finance',
  'integration', 'security',
] as const;
const DATA_SCOPES = ['group', 'organization', 'factory', 'warehouse', 'self'] as const;
const ROLE_KEYS = ['general', 'sales', 'planner', 'production', 'warehouse', 'finance', 'admin'] as const;
const BARCODE_STAGES = ['reporting', 'packaging', 'inbound', 'outbound'] as const;
const BILL_STATUSES = [
  'draft', 'submitted', 'audited', 'executing', 'completed', 'validation-failed',
  'pending-special-approval', 'sync-failed', 'cancelled',
] as const satisfies readonly BillStatus[];
const BILL_ACTIONS = [
  'submit', 'audit', 'start', 'complete', 'special-approve', 'retry-sync', 'cancel',
] as const;
const PERMISSION_ACTIONS = [
  'read', 'supervise', 'create-intent', 'submit', 'audit', 'push-order',
  'special-approve', 'change-order', 'schedule', 'release-batch', 'start-task',
  'complete-task', 'scan-report', 'package', 'stock-in', 'stock-out', 'transfer',
  'retry-sync', 'reconcile', 'allocate-cost', 'approve-cost', 'permission-change',
  'user-admin', 'role-admin', 'reset-demo',
] as const satisfies readonly PermissionAction[];
const AUDIT_ACTIONS = [
  ...new Set<CommandAction>([...BILL_ACTIONS, ...PERMISSION_ACTIONS]),
] as CommandAction[];
const AUDIT_SOURCE_MODULES = [
  'intent-orders', 'sales-orders', 'order-changes', 'credit-approvals',
  'production-tasks', 'inbound', 'outbound', 'transfers', 'reconciliations',
  'cost-collections', 'sync-jobs', 'users', 'roles', 'batches', 'reporting', 'packaging',
] as const satisfies readonly AuditSourceModule[];

export const COMMAND_MATRIX: Record<RecordModule | WorkbenchModule, ModuleRule> = {
  todos: { domain: 'dashboard', actions: { read: 'none', supervise: 'none' } },
  alerts: { domain: 'dashboard', actions: { read: 'none', supervise: 'none' } },
  'intent-orders': {
    domain: 'sales',
    actions: {
      read: 'none', 'create-intent': 'none', submit: 'many', audit: 'many',
      'push-order': 'many', 'special-approve': 'many', cancel: 'many',
    },
  },
  'sales-orders': {
    domain: 'sales',
    actions: {
      read: 'none', submit: 'many', audit: 'many', start: 'many', complete: 'many', cancel: 'many',
    },
  },
  'order-changes': {
    domain: 'sales',
    actions: { read: 'none', 'change-order': 'one', submit: 'many', audit: 'many', cancel: 'many' },
  },
  'credit-approvals': {
    domain: 'sales',
    actions: { read: 'none', 'special-approve': 'one' },
  },
  'production-tasks': {
    domain: 'manufacturing',
    actions: { read: 'none', 'start-task': 'many', 'complete-task': 'many', cancel: 'many' },
  },
  inbound: { domain: 'warehouse', actions: { read: 'none', 'stock-in': 'one' } },
  outbound: { domain: 'warehouse', actions: { read: 'none', 'stock-out': 'one' } },
  transfers: { domain: 'warehouse', actions: { read: 'none', transfer: 'one' } },
  reconciliations: { domain: 'finance', actions: { read: 'none', reconcile: 'many' } },
  'cost-collections': {
    domain: 'finance',
    actions: { read: 'none', 'allocate-cost': 'one', 'approve-cost': 'one' },
  },
  'sync-jobs': { domain: 'integration', actions: { read: 'none', 'retry-sync': 'many' } },
  users: { domain: 'security', actions: { read: 'none', 'user-admin': 'one' } },
  roles: { domain: 'security', actions: { read: 'none', 'role-admin': 'one' } },
  audits: { domain: 'security', actions: { read: 'none' } },
  schedule: { domain: 'planning', actions: { read: 'none', schedule: 'many' } },
  batches: { domain: 'planning', actions: { read: 'none', 'release-batch': 'one' } },
  capacity: { domain: 'planning', actions: { read: 'none', supervise: 'none' } },
  reporting: { domain: 'manufacturing', actions: { read: 'none', 'scan-report': 'one' } },
  packaging: { domain: 'manufacturing', actions: { read: 'none', package: 'one' } },
  stock: {
    domain: 'warehouse',
    actions: { read: 'none', 'stock-in': 'one', 'stock-out': 'one', transfer: 'one' },
  },
  allocation: {
    domain: 'finance',
    actions: { read: 'none', 'allocate-cost': 'one', 'approve-cost': 'one' },
  },
  analysis: { domain: 'finance', actions: { read: 'none', supervise: 'none' } },
  'integration-monitor': { domain: 'integration', actions: { read: 'none' } },
  'sync-mappings': { domain: 'integration', actions: { read: 'none' } },
  permissions: {
    domain: 'security',
    actions: { read: 'none', 'permission-change': 'one', 'reset-demo': 'none' },
  },
};

const clone = <T>(value: T): T => structuredClone(value);
const DANGEROUS_OBJECT_KEYS = new Set([
  '__proto__', 'prototype', 'constructor', 'toJSON',
]);

type JsonSnapshotResult =
  | { valid: true; value: unknown }
  | { valid: false };

const INVALID_JSON_SNAPSHOT = { valid: false } as const;

function copyJsonSafeValue(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonSnapshotResult {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return { valid: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { valid: true, value } : INVALID_JSON_SNAPSHOT;
  }
  if (typeof value !== 'object' || ancestors.has(value)) return INVALID_JSON_SNAPSHOT;

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return INVALID_JSON_SNAPSHOT;
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return INVALID_JSON_SNAPSHOT;
  ancestors.add(value);
  try {
    if (isArray) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        !lengthDescriptor || lengthDescriptor.enumerable ||
        !Object.hasOwn(lengthDescriptor, 'value') ||
        !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0
      ) return INVALID_JSON_SNAPSHOT;
      const length = Number(lengthDescriptor.value);
      if (keys.length !== length + 1 || !keys.includes('length')) return INVALID_JSON_SNAPSHOT;
      const copied: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          return INVALID_JSON_SNAPSHOT;
        }
        const child = copyJsonSafeValue(descriptor.value, ancestors);
        if (!child.valid) return child;
        copied.push(child.value);
      }
      return { valid: true, value: copied };
    }

    const copied: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== 'string' || DANGEROUS_OBJECT_KEYS.has(key)) {
        return INVALID_JSON_SNAPSHOT;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return INVALID_JSON_SNAPSHOT;
      }
      const child = copyJsonSafeValue(descriptor.value, ancestors);
      if (!child.valid) return child;
      copied[key] = child.value;
    }
    return { valid: true, value: copied };
  } finally {
    ancestors.delete(value);
  }
}

function createJsonSafeSnapshot<T>(value: unknown): T | undefined {
  try {
    const snapshot = copyJsonSafeValue(value, new WeakSet<object>());
    return snapshot.valid ? snapshot.value as T : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && Object.hasOwn(ROLE_POLICIES, value);
}

function isDomainKey(value: unknown): value is DomainKey {
  return typeof value === 'string' && (DOMAIN_KEYS as readonly string[]).includes(value);
}

function isDataScope(value: unknown): value is DataScope {
  return typeof value === 'string' && (DATA_SCOPES as readonly string[]).includes(value);
}

function isCommandAction(value: unknown): value is CommandAction {
  return typeof value === 'string' && AUDIT_ACTIONS.includes(value as CommandAction);
}

function isModule(value: unknown): value is RecordModule | WorkbenchModule {
  return typeof value === 'string' && Object.hasOwn(COMMAND_MATRIX, value);
}

function isActor(value: unknown): value is Actor {
  return isObject(value) && isNonEmptyString(value.userId) && isNonEmptyString(value.name) && isRoleKey(value.role);
}

function isAccessContext(value: unknown): value is AccessContext {
  return (
    isObject(value) && isRoleKey(value.role) && isNonEmptyString(value.actorId) &&
    isNonEmptyString(value.organizationId) &&
    (value.factoryId === undefined || isNonEmptyString(value.factoryId)) &&
    (value.warehouseId === undefined || isNonEmptyString(value.warehouseId)) &&
    Object.keys(value).every((key) =>
      ['role', 'actorId', 'organizationId', 'factoryId', 'warehouseId'].includes(key))
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    isObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.recordId) &&
    (isCommandAction(value.action) || value.action === 'role-switch') &&
    isActor(value.actor) && isNonEmptyString(value.occurredAt) &&
    (value.result === 'success' || value.result === 'failed') && typeof value.message === 'string' &&
    typeof value.sourceModule === 'string' && AUDIT_SOURCE_MODULES.includes(value.sourceModule as AuditSourceModule)
  );
}

function isRolePolicy(value: unknown): value is RolePolicy {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['label', 'domains', 'actions', 'scope'])) return false;
  const domains = value.domains;
  const actions = value.actions;
  return (
    isNonEmptyString(value.label) && Array.isArray(domains) && domains.every(isDomainKey) &&
    new Set(domains).size === domains.length && Array.isArray(actions) &&
    actions.every((action) => action === '*' || (PERMISSION_ACTIONS as readonly unknown[]).includes(action)) &&
    new Set(actions).size === actions.length && isDataScope(value.scope)
  );
}

function isBusinessRecord(value: unknown): value is BusinessRecord {
  return (
    isObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.number) &&
    isNonEmptyString(value.title) && isDomainKey(value.domain) && typeof value.status === 'string' &&
    (BILL_STATUSES as readonly string[]).includes(value.status) && isNonEmptyString(value.organizationId) &&
    (value.factoryId === undefined || isNonEmptyString(value.factoryId)) &&
    (value.warehouseId === undefined || isNonEmptyString(value.warehouseId)) &&
    (value.ownerId === undefined || isNonEmptyString(value.ownerId)) &&
    (value.amount === undefined || isNonNegativeNumber(value.amount)) &&
    isNonEmptyString(value.updatedAt) && Array.isArray(value.audit) && value.audit.every(isAuditEvent) &&
    isObject(value.data)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isBarcodeMap(value: unknown): value is BarcodeContext['known'] {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([barcode, entry]) => {
    return (
      isNonEmptyString(barcode) &&
      isObject(entry) &&
      hasExactKeys(entry, ['process', 'kitted', 'outbound']) &&
      typeof entry.process === 'string' &&
      (BARCODE_STAGES as readonly string[]).includes(entry.process) &&
      typeof entry.kitted === 'boolean' &&
      typeof entry.outbound === 'boolean'
    );
  });
}

function isBarcodeScope(value: unknown): value is BarcodeScope {
  return (
    isObject(value) && isNonEmptyString(value.organizationId) &&
    (value.factoryId === undefined || isNonEmptyString(value.factoryId)) &&
    (value.warehouseId === undefined || isNonEmptyString(value.warehouseId)) &&
    (value.ownerId === undefined || isNonEmptyString(value.ownerId)) &&
    Object.keys(value).every((key) =>
      ['organizationId', 'factoryId', 'warehouseId', 'ownerId'].includes(key))
  );
}

function isBarcodeScopeMap(
  value: unknown,
  known: unknown,
): value is Record<string, BarcodeScope> {
  if (!isObject(value) || !isBarcodeMap(known)) return false;
  const knownKeys = Object.keys(known);
  return hasExactKeys(value, knownKeys) && Object.values(value).every(isBarcodeScope);
}

function isWeightItem(value: unknown): value is WeightItem {
  return isObject(value) && isNonEmptyString(value.id) && isNonNegativeNumber(value.weight);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isSourceRecordData(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.sourceNumber) && isOptionalNonEmptyString(data.createdBy);
}

function isIntentData(data: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(data.customer) &&
    typeof data.creditSufficient === 'boolean' &&
    isOptionalNonEmptyString(data.deliveryDate) &&
    isOptionalNonEmptyString(data.workshop) &&
    isOptionalNonEmptyString(data.plannedDate)
  );
}

function isSalesOrderData(data: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(data.customer) &&
    isNonEmptyString(data.sourceNumber) &&
    isOptionalBoolean(data.creditSufficient) &&
    isOptionalNonEmptyString(data.deliveryDate) &&
    isOptionalNonEmptyString(data.workshop) &&
    isOptionalNonEmptyString(data.plannedDate)
  );
}

function isBatchData(data: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(data.workshop) &&
    isNonNegativeNumber(data.capacityUsage) &&
    isNonNegativeInteger(data.orderCount)
  );
}

function isProductionTaskData(data: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(data.packageNumber) &&
    isNonNegativeNumber(data.progress) &&
    Number(data.progress) <= 1
  );
}

function isPackageData(data: Record<string, unknown>, required: boolean): boolean {
  if (required && !isPackageKittingData(data)) return false;
  return (
    (!Object.hasOwn(data, 'kittingRate') ||
      (isNonNegativeNumber(data.kittingRate) && Number(data.kittingRate) <= 1)) &&
    (!Object.hasOwn(data, 'missingParts') || isStringArray(data.missingParts)) &&
    isOptionalNonNegativeInteger(data.requiredQuantity) &&
    isOptionalNonNegativeInteger(data.scannedQuantity) &&
    isOptionalBoolean(data.generated) &&
    isOptionalNonEmptyString(data.packageNumber) &&
    isOptionalNonEmptyString(data.sourcePackage)
  );
}

function isCostCollectionData(data: Record<string, unknown>): boolean {
  return (
    isNonNegativeInteger(data.totalCents) &&
    Array.isArray(data.weights) &&
    data.weights.every(isWeightItem)
  );
}

function isSyncJobData(data: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(data.system) &&
    isNonEmptyString(data.direction) &&
    isNonEmptyString(data.batch) &&
    isNonNegativeInteger(data.attempts) &&
    isOptionalNonEmptyString(data.sourceObject) &&
    isOptionalNonEmptyString(data.targetObject) &&
    isOptionalNonEmptyString(data.errorCode) &&
    isOptionalNonEmptyString(data.errorSummary) &&
    isOptionalNonEmptyString(data.lastResult)
  );
}

function isRecordDataForModule(module: RecordModule, data: Record<string, unknown>): boolean {
  switch (module) {
    case 'todos':
      return isSourceRecordData(data);
    case 'alerts':
      return isNonEmptyString(data.sourceNumber) && isNonNegativeNumber(data.capacityUsage);
    case 'intent-orders':
      return isIntentData(data);
    case 'sales-orders':
      return isSalesOrderData(data);
    case 'order-changes':
      return isNonEmptyString(data.sourceNumber) &&
        (data.changes === undefined || isObject(data.changes));
    case 'credit-approvals':
      return isNonEmptyString(data.sourceNumber);
    case 'production-tasks':
      return isProductionTaskData(data);
    case 'inbound':
    case 'outbound':
      return isPackageData(data, false);
    case 'transfers':
      return isNonEmptyString(data.targetWarehouseId);
    case 'reconciliations':
      return isNonEmptyString(data.sourcePackage);
    case 'cost-collections':
      return isCostCollectionData(data);
    case 'sync-jobs':
      return isSyncJobData(data);
    case 'users':
      return isRoleKey(data.role) && typeof data.enabled === 'boolean';
    case 'roles':
      return isRoleKey(data.role) && isNonNegativeInteger(data.members) &&
        isNonEmptyString(data.responsibility);
    case 'audits':
      return true;
  }
}

function isBusinessRecordForModule(module: RecordModule, value: unknown): value is BusinessRecord {
  return isBusinessRecord(value) && isRecordDataForModule(module, value.data);
}

function isReportingRecordData(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.barcode);
}

function isBusinessRecordForWorkbench(
  module: WorkbenchModule,
  value: unknown,
): value is BusinessRecord {
  if (!isBusinessRecord(value)) return false;
  switch (module) {
    case 'schedule':
      return isIntentData(value.data);
    case 'batches':
    case 'capacity':
      return isBatchData(value.data);
    case 'reporting':
      return isReportingRecordData(value.data);
    case 'packaging':
      return isPackageData(value.data, true);
    case 'stock':
      return isPackageData(value.data, false);
    case 'allocation':
      return isCostCollectionData(value.data);
    case 'integration-monitor':
      return isSyncJobData(value.data);
    case 'permissions':
      return isRecordDataForModule('roles', value.data);
    case 'analysis':
    case 'sync-mappings':
      return true;
  }
}

function isAllocationItem(value: unknown): boolean {
  return (
    isWeightItem(value) &&
    isObject(value) &&
    Number.isInteger(value.amountCents) &&
    Number(value.amountCents) >= 0
  );
}

function isCapacityDay(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.date) &&
    isNonEmptyString(value.workshop) &&
    isNonNegativeNumber(value.usage)
  );
}

function isCustomerProfit(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.customer) &&
    isFiniteNumber(value.revenue) &&
    isFiniteNumber(value.profitRate)
  );
}

function isExpenseVariance(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.item) &&
    isFiniteNumber(value.budget) &&
    isFiniteNumber(value.actual)
  );
}

function isIntegrationSystem(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.name) &&
    typeof value.healthy === 'boolean' &&
    isNonNegativeNumber(value.throughput) &&
    Number.isInteger(value.failures) &&
    Number(value.failures) >= 0
  );
}

function isSyncMapping(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.target) &&
    isNonEmptyString(value.rule) &&
    typeof value.enabled === 'boolean'
  );
}

function isPolicyMap(value: unknown): boolean {
  if (!isObject(value) || !hasExactKeys(value, ROLE_KEYS)) return false;
  return ROLE_KEYS.every((role) => isRolePolicy(value[role]));
}

function isWorkbenchMetadata(module: WorkbenchModule, workbench: Record<string, unknown>): boolean {
  switch (module) {
    case 'schedule':
      return isNonEmptyString(workbench.workshop) && isNonNegativeNumber(workbench.dailyCapacity);
    case 'batches':
      return true;
    case 'capacity':
      return Array.isArray(workbench.days) && workbench.days.every(isCapacityDay);
    case 'reporting':
      return (
        Array.isArray(workbench.successfulScans) &&
        workbench.successfulScans.every((record) =>
          isBusinessRecordForWorkbench('reporting', record)) &&
        isStringArray(workbench.seenBarcodes) &&
        isBarcodeMap(workbench.knownBarcodes) &&
        isBarcodeScopeMap(workbench.barcodeScopes, workbench.knownBarcodes)
      );
    case 'packaging':
      return isStringArray(workbench.seenBarcodes);
    case 'stock':
      return (
        isStringArray(workbench.seenBarcodes) && isBarcodeMap(workbench.knownBarcodes) &&
        isBarcodeScopeMap(workbench.barcodeScopes, workbench.knownBarcodes)
      );
    case 'allocation':
      return (
        Array.isArray(workbench.weights) &&
        workbench.weights.every(isWeightItem) &&
        (workbench.preview === undefined ||
          (Array.isArray(workbench.preview) && workbench.preview.every(isAllocationItem))) &&
        (workbench.totalCents === undefined ||
          (Number.isInteger(workbench.totalCents) && Number(workbench.totalCents) >= 0))
      );
    case 'analysis':
      return (
        Array.isArray(workbench.customerProfit) &&
        workbench.customerProfit.every(isCustomerProfit) &&
        Array.isArray(workbench.expenseVariance) &&
        workbench.expenseVariance.every(isExpenseVariance)
      );
    case 'integration-monitor':
      return Array.isArray(workbench.systems) && workbench.systems.every(isIntegrationSystem);
    case 'sync-mappings':
      return Array.isArray(workbench.mappings) && workbench.mappings.every(isSyncMapping);
    case 'permissions':
      return isPolicyMap(workbench.policies);
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isMockDatabase(value: unknown): value is MockDatabase {
  if (!isObject(value) || !isObject(value.records) || !isObject(value.workbenches)) return false;
  const records = value.records;
  const workbenches = value.workbenches;
  if (!hasExactKeys(records, RECORD_MODULES) || !hasExactKeys(workbenches, WORKBENCH_MODULES)) return false;
  if (!RECORD_MODULES.every((module) => {
    const rows = records[module];
    return Array.isArray(rows) && rows.every((row) => isBusinessRecordForModule(module, row));
  })) return false;
  if (!WORKBENCH_MODULES.every((module) => {
    const workbench = workbenches[module];
    return (
      isObject(workbench) &&
      Array.isArray(workbench.records) &&
      workbench.records.every((record) => isBusinessRecordForWorkbench(module, record)) &&
      isWorkbenchMetadata(module, workbench)
    );
  })) return false;
  if (!isObject(value.roleOverrides)) return false;
  const roleOverrides = value.roleOverrides;
  if (!Object.keys(roleOverrides).every((role) => isRoleKey(role) && isRolePolicy(roleOverrides[role]))) return false;
  return Array.isArray(value.auditEvents) && value.auditEvents.every(isAuditEvent);
}

function loadDatabase(storage: MockStorage): { database: MockDatabase; recovered: boolean } {
  const stored = storage.getItem(MOCK_STORAGE_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      const snapshot = createJsonSafeSnapshot<MockDatabase>(parsed);
      if (snapshot !== undefined && isMockDatabase(snapshot)) {
        return { database: snapshot, recovered: false };
      }
    } catch {
      // Invalid JSON follows the same recovery path as an invalid graph.
    }
  }
  return { database: createFixtureDatabase(), recovered: true };
}

function createEvent(
  database: MockDatabase,
  recordId: string,
  action: CommandAction,
  actor: Actor,
  occurredAt: string,
  result: AuditEvent['result'],
  message: string,
  sourceModule: AuditSourceModule = allowedAuditSourceModules(action)[0] ?? 'users',
): AuditEvent {
  return {
    id: `AUD-${database.auditEvents.length + 1}-${recordId}-${action}`,
    recordId,
    action,
    actor: clone(actor),
    occurredAt,
    result,
    message,
    sourceModule,
  };
}

function appendEvents(database: MockDatabase, events: AuditEvent[]): void {
  database.auditEvents.push(...events.map(clone));
}

function failure(message: string, events: AuditEvent[] = []): OperationResult {
  return { success: false, affectedIds: [], events, message };
}

function success(message: string, affectedIds: string[], events: AuditEvent[]): OperationResult {
  return { success: true, affectedIds, events, message };
}

function authorityRecords(database: MockDatabase, module: RecordModule | WorkbenchModule): BusinessRecord[] {
  if ((RECORD_MODULES as readonly string[]).includes(module)) return database.records[module as RecordModule];
  if (module === 'schedule') return database.records['intent-orders'];
  if (module === 'integration-monitor') return database.records['sync-jobs'];
  if (module === 'allocation') return database.records['cost-collections'];
  if (module === 'permissions') return database.records.roles;
  return database.workbenches[module as WorkbenchModule].records as BusinessRecord[];
}

function trustedPrincipalFromUser(
  database: MockDatabase,
  actorId: string,
): RolePrincipal | undefined {
  const user = database.records.users.find((record) => record.id === actorId);
  if (user?.data.enabled !== true || !isRoleKey(user.data.role)) return undefined;
  const role = user.data.role;
  const access: AccessContext = {
    role,
    actorId: user.id,
    organizationId: user.organizationId,
    ...(user.factoryId === undefined ? {} : { factoryId: user.factoryId }),
    ...(user.warehouseId === undefined ? {} : { warehouseId: user.warehouseId }),
  };
  if (!hasRequiredDataScopeContext(role, access, database.roleOverrides)) return undefined;
  return {
    actor: { userId: user.id, name: user.title, role },
    access,
  };
}

const DATA_SCOPE_ORDER: readonly DataScope[] = [
  'group', 'organization', 'factory', 'warehouse', 'self',
];

function assignableScopesForRole(database: MockDatabase, role: RoleKey): DataScope[] {
  const users = database.records.users.filter(
    (user) => user.data.enabled === true && user.data.role === role,
  );
  if (users.length === 0) return [];
  return DATA_SCOPE_ORDER.filter((scope) => users.some((user) => {
    if (scope === 'group' || scope === 'self') return true;
    if (scope === 'organization') return user.organizationId.trim().length > 0;
    if (scope === 'factory') return Boolean(user.factoryId?.trim());
    return Boolean(user.warehouseId?.trim());
  }));
}

function sameAccessContext(expected: AccessContext, supplied: AccessContext): boolean {
  return (
    expected.role === supplied.role && expected.actorId === supplied.actorId &&
    expected.organizationId === supplied.organizationId &&
    expected.factoryId === supplied.factoryId && expected.warehouseId === supplied.warehouseId
  );
}

function resolveTrustedActor(
  database: MockDatabase,
  actor: Actor,
): RolePrincipal | undefined {
  const principal = trustedPrincipalFromUser(database, actor.userId);
  return principal?.actor.role === actor.role ? principal : undefined;
}

function resolveTrustedAccess(
  database: MockDatabase,
  access: AccessContext,
): RolePrincipal | undefined {
  if (!isAccessContext(access)) return undefined;
  const principal = trustedPrincipalFromUser(database, access.actorId);
  return principal && sameAccessContext(principal.access, access) ? principal : undefined;
}

function recordsMatchingIds(records: BusinessRecord[], ids: string[]): BusinessRecord[] {
  return records.filter((record) => ids.some((id) =>
    record.id === id || record.number === id || record.data.role === id,
  ));
}

function barcodeScopes(
  database: MockDatabase,
  module: 'reporting' | 'stock',
): Record<string, BarcodeScope> {
  return database.workbenches[module].barcodeScopes as Record<string, BarcodeScope>;
}

function barcodeScopeRecord(
  database: MockDatabase,
  module: 'reporting' | 'stock',
  rawBarcode: string,
): BusinessRecord | undefined {
  const barcode = rawBarcode.trim().toUpperCase();
  const scope = barcodeScopes(database, module)[barcode];
  if (!scope) return undefined;
  return {
    id: barcode,
    number: barcode,
    title: `${barcode} 权威条码范围`,
    domain: module === 'reporting' ? 'manufacturing' : 'warehouse',
    status: 'submitted',
    organizationId: scope.organizationId,
    ...(scope.factoryId === undefined ? {} : { factoryId: scope.factoryId }),
    ...(scope.warehouseId === undefined ? {} : { warehouseId: scope.warehouseId }),
    ...(scope.ownerId === undefined ? {} : { ownerId: scope.ownerId }),
    updatedAt: 'scope-authority',
    audit: [],
    data: { barcode },
  };
}

function commandTargets(database: MockDatabase, command: PerformCommand): BusinessRecord[] {
  const directRecordModule = (module: RecordModule) =>
    recordsMatchingIds(database.records[module], command.ids);
  switch (command.action) {
    case 'create-intent': {
      const access = command.access;
      if (!access) return [];
      return [{
        id: 'scope-candidate', number: 'scope-candidate', title: 'scope-candidate',
        domain: 'sales', status: 'draft', organizationId: access.organizationId,
        ...(access.factoryId === undefined ? {} : { factoryId: access.factoryId }),
        ...(access.warehouseId === undefined ? {} : { warehouseId: access.warehouseId }),
        ownerId: access.actorId, updatedAt: 'scope-check', audit: [], data: {},
      }];
    }
    case 'schedule': return recordsMatchingIds(database.records['intent-orders'], command.ids);
    case 'release-batch':
      return recordsMatchingIds(database.workbenches.batches.records as BusinessRecord[], command.ids);
    case 'scan-report': {
      const barcode = String(command.payload?.barcode ?? command.ids[0] ?? '');
      const target = barcodeScopeRecord(database, 'reporting', barcode);
      return target ? [target] : [];
    }
    case 'package':
      return recordsMatchingIds(database.workbenches.packaging.records as BusinessRecord[], command.ids);
    case 'stock-in':
    case 'stock-out': {
      const barcode = String(command.payload?.barcode ?? command.ids[0] ?? '');
      const target = barcodeScopeRecord(database, 'stock', barcode);
      return target ? [target] : [];
    }
    case 'transfer': return recordsMatchingIds(database.records.transfers, command.ids);
    case 'reconcile': return recordsMatchingIds(database.records.reconciliations, command.ids);
    case 'allocate-cost':
    case 'approve-cost': return recordsMatchingIds(database.records['cost-collections'], command.ids);
    case 'retry-sync': return recordsMatchingIds(database.records['sync-jobs'], command.ids);
    case 'permission-change': return recordsMatchingIds(database.records.roles, command.ids);
    case 'user-admin': return recordsMatchingIds(database.records.users, command.ids);
    case 'role-admin': return recordsMatchingIds(database.records.roles, command.ids);
    case 'change-order': return recordsMatchingIds(database.records['order-changes'], command.ids);
    case 'start-task':
    case 'complete-task': return recordsMatchingIds(database.records['production-tasks'], command.ids);
    case 'special-approve': {
      if (command.module === 'credit-approvals') {
        const approvals = directRecordModule('credit-approvals');
        const intents = approvals.flatMap((approval) => {
          const source = approval.data.sourceNumber;
          return typeof source === 'string'
            ? recordsMatchingIds(database.records['intent-orders'], [source])
            : [];
        });
        return [...approvals, ...intents];
      }
      return directRecordModule('intent-orders');
    }
    case 'submit':
    case 'audit':
    case 'push-order':
    case 'start':
    case 'complete':
    case 'cancel':
      return (RECORD_MODULES as readonly string[]).includes(command.module)
        ? directRecordModule(command.module as RecordModule)
        : [];
    case 'read':
    case 'supervise':
    case 'reset-demo': return [];
  }
}

function commandAccessError(
  database: MockDatabase,
  command: PerformCommand,
  principal: RolePrincipal,
): string | undefined {
  const policy = database.roleOverrides[principal.actor.role] ?? ROLE_POLICIES[principal.actor.role];
  const suppliedAccess = command.access;
  if (!suppliedAccess) {
    if (policy.scope !== 'group') return '写入操作缺少数据范围';
  } else if (!isAccessContext(suppliedAccess)) {
    return '写入数据范围结构无效';
  } else if (!sameAccessContext(principal.access, suppliedAccess)) {
    return '写入数据范围与可信操作人不匹配';
  }

  const payload = command.payload;
  if (command.module === 'intent-orders' && command.action === 'create-intent' && isObject(payload)) {
    if (
      (payload.organizationId !== undefined && payload.organizationId !== principal.access.organizationId) ||
      (payload.ownerId !== undefined && payload.ownerId !== principal.actor.userId) ||
      (payload.factoryId !== undefined && payload.factoryId !== principal.access.factoryId) ||
      (payload.warehouseId !== undefined && payload.warehouseId !== principal.access.warehouseId)
    ) return '新建订购意向范围与可信操作人不匹配';
  }

  const trustedCommand = { ...command, actor: principal.actor, access: principal.access };
  const targets = commandTargets(database, trustedCommand);
  const isWrite = command.action !== 'read' && command.action !== 'supervise';
  if (isWrite && policy.scope !== 'group' && targets.length === 0) return '写入目标缺少权威数据范围';
  if (
    targets.length > 0 &&
    filterByDataScope(
      principal.actor.role,
      targets,
      principal.access,
      database.roleOverrides,
    ).length !== targets.length
  ) return '写入目标超出数据范围';
  return undefined;
}

function findRecord(database: MockDatabase, module: RecordModule | WorkbenchModule, id: string): BusinessRecord | undefined {
  return authorityRecords(database, module).find((row) => row.id === id || row.number === id);
}

function replaceRecord(database: MockDatabase, module: RecordModule | WorkbenchModule, record: BusinessRecord): void {
  const records = authorityRecords(database, module);
  const index = records.findIndex((row) => row.id === record.id || row.number === record.number);
  if (index >= 0) records[index] = record;
}

function replaceOrInsert(records: BusinessRecord[], record: BusinessRecord): void {
  const index = records.findIndex((row) => row.id === record.id || row.number === record.number);
  if (index >= 0) records[index] = record;
  else records.push(record);
}

function transition(
  record: BusinessRecord,
  action: BillAction,
  actor: Actor,
  now: string,
  sourceModule: AuditSourceModule,
): BusinessRecord {
  return transitionBill(record, action, clone(actor), now, sourceModule);
}

function performLifecycle(
  database: MockDatabase,
  command: PerformCommand,
  action: BillAction,
  now: string,
): OperationResult {
  const changes: BusinessRecord[] = [];
  try {
    for (const id of command.ids) {
      const record = findRecord(database, command.module, id);
      if (!record) return failure(`未找到单据：${id}`);
      changes.push(transition(record, action, command.actor, now, command.module as AuditSourceModule));
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : '单据状态转换失败');
  }
  const events = changes.map((record) => record.audit.at(-1) as AuditEvent);
  for (const record of changes) replaceRecord(database, command.module, record);
  appendEvents(database, events);
  return success('操作成功', changes.map((record) => record.id), events);
}

function createOrderAndTodo(database: MockDatabase, intent: BusinessRecord, actor: Actor, now: string): void {
  if (!database.records['sales-orders'].some((row) => row.data.sourceNumber === intent.number)) {
    const number = `SO-${intent.number.slice(3)}`;
    database.records['sales-orders'].push({
      ...clone(intent), id: number, number,
      title: intent.title.replace('订购意向', '销售订单'),
      status: 'audited', updatedAt: now, audit: [],
      data: { ...intent.data, sourceNumber: intent.number },
    });
  }
  if (!database.records.todos.some((row) => row.data.sourceNumber === intent.number)) {
    const number = `TODO-${intent.number}`;
    database.records.todos.push({
      id: number, number, title: `待排程：${intent.title}`, domain: 'planning',
      status: 'submitted', organizationId: intent.organizationId,
      ...(intent.factoryId === undefined ? {} : { factoryId: intent.factoryId }),
      ownerId: 'u-planner', updatedAt: now, audit: [],
      data: { sourceNumber: intent.number, createdBy: actor.name },
    });
  }
}

function auditIntent(
  database: MockDatabase,
  command: PerformCommand,
  action: 'audit' | 'push-order' | 'special-approve',
  now: string,
): OperationResult {
  const intents: BusinessRecord[] = [];
  for (const id of command.ids) {
    const intent = findRecord(database, 'intent-orders', id);
    if (!intent) return failure(`未找到订购意向：${id}`);
    intents.push(intent);
  }
  if (action === 'audit') {
    const insufficient = intents.find((intent) => intent.data.creditSufficient === false);
    if (insufficient) {
      const event = createEvent(database, insufficient.id, 'audit', command.actor, now, 'failed', '信用额度不足，转入信用特批');
      replaceRecord(database, 'intent-orders', {
        ...insufficient, status: 'pending-special-approval', updatedAt: now,
        audit: [...insufficient.audit, event],
      });
      appendEvents(database, [event]);
      return { success: false, affectedIds: [insufficient.id], events: [event], message: '信用额度不足，已转入待特批' };
    }
  }

  const changes: BusinessRecord[] = [];
  const events: AuditEvent[] = [];
  try {
    for (const intent of intents) {
      if (action === 'push-order') {
        if (intent.status !== 'audited') return failure('订购意向审核后才能下推销售订单');
        const event = createEvent(database, intent.id, action, command.actor, now, 'success', '下推销售订单成功');
        changes.push({ ...intent, updatedAt: now, audit: [...intent.audit, event] });
        events.push(event);
      } else {
        const next = transition(intent, action, command.actor, now, 'intent-orders');
        changes.push(next);
        events.push(next.audit.at(-1) as AuditEvent);
      }
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : '订购意向审核失败');
  }
  for (const intent of changes) {
    replaceRecord(database, 'intent-orders', intent);
    createOrderAndTodo(database, intent, command.actor, now);
  }
  appendEvents(database, events);
  return success(action === 'push-order' ? '下推销售订单成功' : '审核成功', changes.map((record) => record.id), events);
}

function approveCredit(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const approval = findRecord(database, 'credit-approvals', command.ids[0]);
  if (!approval) return failure(`未找到信用特批：${command.ids[0]}`);
  const sourceNumber = approval.data.sourceNumber;
  if (!isNonEmptyString(sourceNumber)) return failure('信用特批缺少关联订购意向');
  const intent = findRecord(database, 'intent-orders', sourceNumber);
  if (!intent) return failure(`未找到关联订购意向：${sourceNumber}`);
  try {
    const nextApproval = transition(approval, 'special-approve', command.actor, now, 'credit-approvals');
    const nextIntent = transition(intent, 'special-approve', command.actor, now, 'intent-orders');
    const events = [nextApproval.audit.at(-1) as AuditEvent, nextIntent.audit.at(-1) as AuditEvent];
    replaceRecord(database, 'credit-approvals', nextApproval);
    replaceRecord(database, 'intent-orders', nextIntent);
    createOrderAndTodo(database, nextIntent, command.actor, now);
    appendEvents(database, events);
    return success('信用特批通过', [nextApproval.id, nextIntent.id], events);
  } catch (error) {
    return failure(error instanceof Error ? error.message : '信用特批失败');
  }
}

function releaseBatch(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'batches', command.ids[0]);
  if (!record) return failure(`未找到批次：${command.ids[0]}`);
  const capacityUsage = Number(command.payload?.capacityUsage ?? record.data.capacityUsage);
  const workshop = String(command.payload?.workshop ?? record.data.workshop ?? '当前车间');
  if (!Number.isFinite(capacityUsage) || capacityUsage > 1) {
    const percentage = Number.isFinite(capacityUsage) ? Math.round(capacityUsage * 100) : 0;
    const message = `${workshop}产能占用 ${percentage}%，无法投放`;
    const event = createEvent(database, record.id, 'release-batch', command.actor, now, 'failed', message);
    replaceRecord(database, 'batches', { ...record, audit: [...record.audit, event] });
    appendEvents(database, [event]);
    return failure(message, [event]);
  }
  const event = createEvent(database, record.id, 'release-batch', command.actor, now, 'success', '批次投放成功');
  replaceRecord(database, 'batches', {
    ...record, status: 'executing', updatedAt: now, audit: [...record.audit, event],
  });
  appendEvents(database, [event]);
  return success('批次投放成功', [record.id], [event]);
}

function barcodeContext(database: MockDatabase, module: 'reporting' | 'stock', stage: BarcodeStage): BarcodeContext {
  const workbench = database.workbenches[module];
  return {
    stage,
    seen: new Set((workbench.seenBarcodes as string[] | undefined) ?? []),
    known: (workbench.knownBarcodes as BarcodeContext['known'] | undefined) ?? {},
  };
}

function rememberBarcode(database: MockDatabase, module: 'reporting' | 'stock', barcode: string): void {
  const workbench = database.workbenches[module];
  const seen = (workbench.seenBarcodes as string[] | undefined) ?? [];
  if (!seen.includes(barcode)) seen.push(barcode);
  workbench.seenBarcodes = seen;
}

function performScan(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const barcode = String(command.payload?.barcode ?? command.ids[0]);
  const validation = validateBarcode(barcode, barcodeContext(database, 'reporting', 'reporting'));
  if (!validation.valid) {
    const normalized = barcode.trim().toUpperCase() || 'UNKNOWN-BARCODE';
    const event = createEvent(database, normalized, 'scan-report', command.actor, now, 'failed', validation.message);
    appendEvents(database, [event]);
    return failure(validation.message, [event]);
  }
  const scope = barcodeScopes(database, 'reporting')[validation.barcode];
  if (!scope) return failure('条码缺少权威数据范围');
  const event = createEvent(database, validation.barcode, 'scan-report', command.actor, now, 'success', '扫码报工成功');
  const record: BusinessRecord = {
    id: validation.barcode, number: validation.barcode, title: '扫码报工记录',
    domain: 'manufacturing', status: 'completed', organizationId: scope.organizationId,
    ...(scope.factoryId === undefined ? {} : { factoryId: scope.factoryId }),
    ...(scope.warehouseId === undefined ? {} : { warehouseId: scope.warehouseId }),
    ...(scope.ownerId === undefined ? {} : { ownerId: scope.ownerId }),
    updatedAt: now, audit: [event], data: { barcode: validation.barcode },
  };
  rememberBarcode(database, 'reporting', validation.barcode);
  (database.workbenches.reporting.successfulScans as BusinessRecord[]).push(record);
  (database.workbenches.reporting.records as BusinessRecord[]).push(record);
  appendEvents(database, [event]);
  return success('扫码报工成功', [record.id], [event]);
}

function createPackage(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'packaging', command.ids[0]);
  if (!record) return failure(`未找到包装任务：${command.ids[0]}`);
  if (!isPackageKittingData(record.data)) return failure('包装齐套数据无效');
  if (record.data.kittingRate < 1) {
    const missing = record.data.missingParts.join('、');
    return failure(`包件尚未齐套，缺少：${missing}`);
  }
  const event = createEvent(database, record.id, 'package', command.actor, now, 'success', '包件生成成功');
  const packaged: BusinessRecord = {
    ...record, status: 'completed', updatedAt: now, audit: [...record.audit, event],
    data: { ...record.data, generated: true },
  };
  replaceRecord(database, 'packaging', packaged);
  replaceOrInsert(database.records.inbound, {
    ...clone(packaged), domain: 'warehouse', status: 'submitted', audit: [],
    data: { ...packaged.data, sourcePackage: packaged.number },
  });
  const known = database.workbenches.stock.knownBarcodes as BarcodeContext['known'];
  known[packaged.number] = { process: 'outbound', kitted: true, outbound: false };
  barcodeScopes(database, 'stock')[packaged.number] = {
    organizationId: packaged.organizationId,
    ...(packaged.factoryId === undefined ? {} : { factoryId: packaged.factoryId }),
    warehouseId: packaged.warehouseId ?? command.access?.warehouseId ?? 'WH-02',
    ownerId: command.access?.actorId ?? command.actor.userId,
  };
  appendEvents(database, [event]);
  return success('包件生成成功', [record.id], [event]);
}

function performStock(
  database: MockDatabase,
  command: PerformCommand,
  action: 'stock-in' | 'stock-out' | 'transfer',
  now: string,
): OperationResult {
  const raw = String(command.payload?.barcode ?? command.ids[0]);
  const barcode = raw.trim().toUpperCase();
  if (action === 'transfer') {
    const record = database.records.transfers.find((row) => row.id === command.ids[0] || row.number === command.ids[0]);
    if (!record) return failure(`未找到调拨单：${command.ids[0]}`);
    const targetWarehouseId = command.payload?.targetWarehouseId ?? record.data.targetWarehouseId;
    if (!isNonEmptyString(targetWarehouseId)) return failure('调拨需要目标仓库');
    const event = createEvent(database, record.id, action, command.actor, now, 'success', '调拨成功');
    replaceOrInsert(database.records.transfers, {
      ...record, status: 'completed', updatedAt: now, audit: [...record.audit, event],
      data: { ...record.data, targetWarehouseId },
    });
    appendEvents(database, [event]);
    return success('调拨成功', [record.id], [event]);
  }

  const packageRecords = database.workbenches.packaging.records as BusinessRecord[];
  const packageRecord = packageRecords.find((row) => row.id === barcode || row.number === barcode);
  const known = database.workbenches.stock.knownBarcodes as BarcodeContext['known'];
  if (packageRecord && known[barcode]) {
    known[barcode] = { ...known[barcode], kitted: Number(packageRecord.data.kittingRate) === 1 };
  }
  const stage: BarcodeStage = action === 'stock-in' ? 'inbound' : 'outbound';
  const validation = validateBarcode(barcode, barcodeContext(database, 'stock', stage));
  if (!validation.valid) {
    const missing = (packageRecord?.data.missingParts as string[] | undefined)?.join('、');
    const message = validation.code === 'not-kitted' && missing
      ? `包件尚未齐套，缺少：${missing}`
      : validation.message;
    const event = createEvent(database, barcode || 'UNKNOWN-BARCODE', action, command.actor, now, 'failed', message);
    appendEvents(database, [event]);
    return failure(message, [event]);
  }
  const scope = barcodeScopes(database, 'stock')[validation.barcode];
  if (!scope) return failure('条码缺少权威数据范围');
  const source = database.records.inbound.find((row) => row.id === barcode || row.number === barcode) ?? packageRecord;
  const event = createEvent(
    database, barcode, action, command.actor, now, 'success',
    action === 'stock-in' ? '扫码入库成功' : '扫码出库成功',
  );
  const completed: BusinessRecord = source
    ? {
        ...clone(source), domain: 'warehouse', status: 'completed',
        organizationId: scope.organizationId,
        ...(scope.factoryId === undefined ? {} : { factoryId: scope.factoryId }),
        ...(scope.warehouseId === undefined ? {} : { warehouseId: scope.warehouseId }),
        ...(scope.ownerId === undefined ? {} : { ownerId: scope.ownerId }),
        updatedAt: now, audit: [...source.audit, event],
      }
    : {
        id: barcode, number: barcode, title: action === 'stock-in' ? '扫码入库包件' : '扫码出库包件',
        domain: 'warehouse', status: 'completed', organizationId: scope.organizationId,
        ...(scope.factoryId === undefined ? {} : { factoryId: scope.factoryId }),
        ...(scope.warehouseId === undefined ? {} : { warehouseId: scope.warehouseId }),
        ...(scope.ownerId === undefined ? {} : { ownerId: scope.ownerId }),
        updatedAt: now, audit: [event], data: {},
      };
  rememberBarcode(database, 'stock', barcode);
  if (action === 'stock-in') {
    replaceOrInsert(database.records.inbound, completed);
  } else {
    replaceOrInsert(database.records.outbound, completed);
    known[barcode] = { ...(known[barcode] ?? { process: 'outbound', kitted: true }), outbound: true };
    const reconciliationNumber = `REC-${barcode}`;
    if (!database.records.reconciliations.some((row) => row.data.sourcePackage === barcode)) {
      database.records.reconciliations.push({
        id: reconciliationNumber, number: reconciliationNumber, title: `${completed.title}应收对账`,
        domain: 'finance', status: 'submitted', organizationId: completed.organizationId,
        ...(completed.amount === undefined ? {} : { amount: completed.amount }),
        updatedAt: now, audit: [], data: { sourcePackage: barcode },
      });
    }
  }
  appendEvents(database, [event]);
  return success(event.message, [completed.id], [event]);
}

function reconcile(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const changes: BusinessRecord[] = [];
  const events: AuditEvent[] = [];
  for (const id of command.ids) {
    const record = findRecord(database, 'reconciliations', id);
    if (!record) return failure(`未找到核销记录：${id}`);
    const event = createEvent(database, record.id, 'reconcile', command.actor, now, 'success', '核销成功');
    changes.push({ ...record, status: 'completed', updatedAt: now, audit: [...record.audit, event] });
    events.push(event);
  }
  for (const record of changes) replaceRecord(database, 'reconciliations', record);
  appendEvents(database, events);
  return success('核销成功', changes.map((record) => record.id), events);
}

function allocateCost(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const source = findRecord(database, 'cost-collections', command.ids[0]);
  if (!source) return failure(`未找到成本归集：${command.ids[0]}`);
  const totalCents = command.payload?.totalCents ?? source.data.totalCents;
  const weights = command.payload?.weights ?? source.data.weights;
  if (!isNonNegativeInteger(totalCents)) return failure('总金额必须是非负整数');
  if (!Array.isArray(weights) || !weights.every(isWeightItem)) {
    return failure('物理权重项目需要非空标识和有限非负权重');
  }
  try {
    const allocations = allocateByPhysicalWeight(totalCents, weights);
    database.workbenches.allocation.preview = allocations;
    database.workbenches.allocation.totalCents = totalCents;
    const event = createEvent(database, source.id, 'allocate-cost', command.actor, now, 'success', '成本分摊试算成功');
    appendEvents(database, [event]);
    return success('成本分摊试算成功', [source.id], [event]);
  } catch (error) {
    return failure(error instanceof Error ? error.message : '成本分摊失败');
  }
}

function retrySync(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const records: BusinessRecord[] = [];
  for (const id of command.ids) {
    const record = findRecord(database, 'sync-jobs', id);
    if (!record) {
      const event = createEvent(database, id, 'retry-sync', command.actor, now, 'failed', '未找到同步任务');
      appendEvents(database, [event]);
      return failure(`未找到同步任务：${id}`, [event]);
    }
    if (record.status !== 'sync-failed') {
      const event = createEvent(database, record.id, 'retry-sync', command.actor, now, 'failed', '只有同步失败任务可以重试');
      replaceRecord(database, 'sync-jobs', { ...record, audit: [...record.audit, event] });
      appendEvents(database, [event]);
      return failure(event.message, [event]);
    }
    records.push(record);
  }
  const changes: BusinessRecord[] = [];
  const events: AuditEvent[] = [];
  try {
    for (const record of records) {
      const executing = transition(record, 'retry-sync', command.actor, now, 'sync-jobs');
      const completed = transition(executing, 'complete', command.actor, now, 'sync-jobs');
      changes.push({
        ...completed,
        data: {
          ...completed.data,
          attempts: Number(completed.data.attempts ?? 0) + 1,
          lastResult: 'success',
        },
      });
      events.push(...completed.audit.slice(record.audit.length));
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : '同步重试失败');
  }
  for (const record of changes) replaceRecord(database, 'sync-jobs', record);
  appendEvents(database, events);
  return success('重试成功', changes.map((record) => record.id), events);
}

function changePermission(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const role = command.ids[0];
  if (!isRoleKey(role)) return failure(`未知角色：${role}`);
  if (!isObject(command.payload)) return failure('授权策略不能为空');
  if (Object.hasOwn(command.payload, 'policy') && !isRolePolicy(command.payload.policy)) {
    return failure('授权策略结构无效');
  }
  const base = database.roleOverrides[role] ?? ROLE_POLICIES[role];
  const supplied = Object.hasOwn(command.payload, 'policy')
    ? command.payload.policy
    : {
        label: command.payload.label ?? base.label,
        domains: command.payload.domains ?? base.domains,
        actions: command.payload.actions ?? base.actions,
        scope: command.payload.scope ?? base.scope,
      };
  if (!isRolePolicy(supplied)) return failure('授权策略结构无效');
  const next = clone(supplied);
  const previous = database.roleOverrides[role];
  database.roleOverrides[role] = next;
  const hasTrustedPrincipal = database.records.users.some((user) => {
    if (user.data.role !== role) return false;
    return trustedPrincipalFromUser(database, user.id)?.actor.role === role;
  });
  if (!hasTrustedPrincipal) {
    if (previous) database.roleOverrides[role] = previous;
    else delete database.roleOverrides[role];
    const scopeLabel: Record<DataScope, string> = {
      group: '集团', organization: '组织', factory: '工厂', warehouse: '仓库', self: '本人',
    };
    return failure(`目标角色没有满足${scopeLabel[next.scope]}数据范围的启用用户`);
  }
  const event = createEvent(database, role, 'permission-change', command.actor, now, 'success', `${next.label}授权已保存`);
  appendEvents(database, [event]);
  database.workbenches.permissions.policies = { ...clone(ROLE_POLICIES), ...clone(database.roleOverrides) };
  return success('授权保存成功', [role], [event]);
}

function completeProductionTask(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const result = performLifecycle(database, command, 'complete', now);
  if (!result.success) return result;
  for (const id of command.ids) {
    const task = findRecord(database, 'production-tasks', id);
    const packageNumber = String(task?.data.packageNumber ?? '');
    const packaging = findRecord(database, 'packaging', packageNumber);
    if (packaging) {
      replaceRecord(database, 'packaging', {
        ...packaging,
        data: {
          ...packaging.data, kittingRate: 1, missingParts: [],
          scannedQuantity: packaging.data.requiredQuantity ?? 4,
        },
      });
      const known = database.workbenches.stock.knownBarcodes as BarcodeContext['known'];
      if (known[packageNumber]) known[packageNumber] = { ...known[packageNumber], kitted: true };
    }
  }
  return result;
}

function createIntent(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  if (!isObject(command.payload)) return failure('新建订购意向需要业务数据');
  const { number, title, customer } = command.payload;
  if (!isNonEmptyString(number) || !isNonEmptyString(title) || !isNonEmptyString(customer)) {
    return failure('新建订购意向需要单据号、标题和客户');
  }
  if (command.payload.amount !== undefined && !isNonNegativeNumber(command.payload.amount)) {
    return failure('订购意向金额必须是有限非负数');
  }
  if (
    command.payload.creditSufficient !== undefined &&
    typeof command.payload.creditSufficient !== 'boolean'
  ) return failure('信用额度状态无效');
  if (database.records['intent-orders'].some((record) => record.number === number)) return failure(`订购意向已存在：${number}`);
  const trustedAccess = command.access;
  if (!trustedAccess) return failure('新建订购意向缺少可信数据范围');
  const event = createEvent(database, number, 'create-intent', command.actor, now, 'success', '订购意向创建成功');
  database.records['intent-orders'].push({
    id: number, number, title, domain: 'sales', status: 'draft',
    organizationId: trustedAccess.organizationId,
    ...(trustedAccess.factoryId === undefined ? {} : { factoryId: trustedAccess.factoryId }),
    ...(trustedAccess.warehouseId === undefined ? {} : { warehouseId: trustedAccess.warehouseId }),
    ownerId: trustedAccess.actorId,
    ...(command.payload.amount === undefined ? {} : { amount: command.payload.amount }),
    updatedAt: now, audit: [event],
    data: { customer, creditSufficient: command.payload.creditSufficient !== false },
  });
  appendEvents(database, [event]);
  return success('订购意向创建成功', [number], [event]);
}

function scheduleOrders(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const workshop = command.payload?.workshop;
  const plannedDate = command.payload?.plannedDate;
  if (!isNonEmptyString(workshop) || !isNonEmptyString(plannedDate)) return failure('排程需要车间和计划日期');
  const records: BusinessRecord[] = [];
  for (const id of command.ids) {
    const record = findRecord(database, 'intent-orders', id);
    if (!record) return failure(`未找到待排程订购意向：${id}`);
    records.push(record);
  }
  const events = records.map((record) => createEvent(database, record.id, 'schedule', command.actor, now, 'success', '排程成功'));
  records.forEach((record, index) => {
    replaceRecord(database, 'intent-orders', {
      ...record, updatedAt: now, audit: [...record.audit, events[index]],
      data: { ...record.data, workshop, plannedDate },
    });
  });
  appendEvents(database, events);
  return success('排程成功', records.map((record) => record.id), events);
}

function changeOrder(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'order-changes', command.ids[0]);
  const changes = command.payload?.changes;
  if (!record) return failure(`未找到订单变更：${command.ids[0]}`);
  if (!isObject(changes)) return failure('订单变更需要变更内容');
  if (!hasExactKeys(changes, changes.quantityDelta === undefined
    ? ['reason', 'deliveryDate']
    : ['reason', 'deliveryDate', 'quantityDelta'])) return failure('订单变更字段无效');
  const reason = changes.reason;
  const deliveryDate = changes.deliveryDate;
  const quantityDelta = changes.quantityDelta;
  if (!isNonEmptyString(reason)) return failure('变更原因不能为空');
  if (typeof deliveryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return failure('交付日期格式无效');
  }
  const parsedDate = new Date(`${deliveryDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== deliveryDate) {
    return failure('交付日期无效');
  }
  if (
    quantityDelta !== undefined &&
    (typeof quantityDelta !== 'number' || !Number.isFinite(quantityDelta) || !Number.isInteger(quantityDelta) || quantityDelta === 0 ||
      Math.abs(quantityDelta) > 1_000_000)
  ) return failure('数量调整必须是范围内的非零整数');
  const normalizedChanges = {
    reason: reason.trim(), deliveryDate,
    ...(quantityDelta === undefined ? {} : { quantityDelta }),
  };
  const event = createEvent(database, record.id, 'change-order', command.actor, now, 'success', '订单变更已保存');
  replaceRecord(database, 'order-changes', {
    ...record, updatedAt: now, audit: [...record.audit, event],
    data: { ...record.data, changes: normalizedChanges },
  });
  appendEvents(database, [event]);
  return success('订单变更已保存', [record.id], [event]);
}

function approveCost(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'cost-collections', command.ids[0]);
  if (!record) return failure(`未找到成本归集：${command.ids[0]}`);
  const event = createEvent(database, record.id, 'approve-cost', command.actor, now, 'success', '成本归集审批通过');
  replaceRecord(database, 'cost-collections', {
    ...record, status: 'completed', updatedAt: now, audit: [...record.audit, event],
  });
  appendEvents(database, [event]);
  return success('成本归集审批通过', [record.id], [event]);
}

function userHasRequiredRoleScope(
  database: MockDatabase,
  record: BusinessRecord,
  role: RoleKey,
): boolean {
  const policy = database.roleOverrides[role] ?? ROLE_POLICIES[role];
  if (policy.scope === 'self' && record.ownerId !== record.id) return false;
  return hasRequiredDataScopeContext(role, {
    actorId: record.id,
    organizationId: record.organizationId,
    ...(record.factoryId === undefined ? {} : { factoryId: record.factoryId }),
    ...(record.warehouseId === undefined ? {} : { warehouseId: record.warehouseId }),
  }, database.roleOverrides);
}

function administerUser(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'users', command.ids[0]);
  if (!record) return failure(`未找到用户：${command.ids[0]}`);
  const enabled = command.payload?.enabled;
  const role = command.payload?.role;
  if (enabled === undefined && role === undefined) return failure('用户管理需要启用状态或角色');
  if (enabled !== undefined && typeof enabled !== 'boolean') return failure('用户启用状态无效');
  if (role !== undefined && !isRoleKey(role)) return failure('用户角色无效');
  const currentRole = record.data.role;
  const currentEnabled = record.data.enabled;
  if (!isRoleKey(currentRole) || typeof currentEnabled !== 'boolean') return failure('用户目录状态无效');
  const actorIsAdmin = command.actor.role === 'admin';
  if (!actorIsAdmin) {
    if (record.id === command.actor.userId) return failure('委派管理员不能修改自己的角色或启用状态');
    if (currentRole === 'admin') return failure('委派管理员不能修改管理员用户');
    if (role !== undefined) return failure('只有管理员可以修改用户角色');
  }
  const nextRole = role ?? currentRole;
  const nextEnabled = enabled ?? currentEnabled;
  if (role !== undefined && !userHasRequiredRoleScope(database, record, nextRole)) {
    return failure('目标用户缺少新角色所需的数据范围');
  }
  const enabledAdminCount = database.records.users.filter((user) => {
    const candidateRole = user.id === record.id ? nextRole : user.data.role;
    const candidateEnabled = user.id === record.id ? nextEnabled : user.data.enabled;
    return candidateRole === 'admin' && candidateEnabled === true;
  }).length;
  if (enabledAdminCount === 0) return failure('必须保留至少一个启用的管理员');
  const event = createEvent(database, record.id, 'user-admin', command.actor, now, 'success', '用户信息已更新');
  replaceRecord(database, 'users', {
    ...record, updatedAt: now, audit: [...record.audit, event],
    data: { ...record.data, ...(enabled === undefined ? {} : { enabled }), ...(role === undefined ? {} : { role }) },
  });
  appendEvents(database, [event]);
  return success('用户信息已更新', [record.id], [event]);
}

function administerRole(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  const record = findRecord(database, 'roles', command.ids[0]);
  if (!record) return failure(`未找到角色：${command.ids[0]}`);
  const members = command.payload?.members;
  const responsibility = command.payload?.responsibility;
  if (members === undefined && responsibility === undefined) return failure('角色管理需要成员数或职责');
  if (members !== undefined && (!Number.isInteger(members) || Number(members) < 0)) return failure('角色成员数无效');
  if (responsibility !== undefined && !isNonEmptyString(responsibility)) return failure('角色职责无效');
  const event = createEvent(database, record.id, 'role-admin', command.actor, now, 'success', '角色信息已更新');
  replaceRecord(database, 'roles', {
    ...record, updatedAt: now, audit: [...record.audit, event],
    data: {
      ...record.data,
      ...(members === undefined ? {} : { members }),
      ...(responsibility === undefined ? {} : { responsibility }),
    },
  });
  appendEvents(database, [event]);
  return success('角色信息已更新', [record.id], [event]);
}

function resetCandidate(database: MockDatabase, actor: Actor, now: string): OperationResult {
  const fresh = createFixtureDatabase();
  database.records = fresh.records;
  database.workbenches = fresh.workbenches;
  database.roleOverrides = fresh.roleOverrides;
  database.auditEvents = fresh.auditEvents;
  const event = createEvent(database, 'mock-database', 'reset-demo', actor, now, 'success', '演示数据已重置');
  appendEvents(database, [event]);
  return success('演示数据已重置', ['mock-database'], [event]);
}

function dispatchPerform(database: MockDatabase, command: PerformCommand, now: string): OperationResult {
  switch (command.action) {
    case 'submit':
    case 'start':
    case 'complete':
    case 'cancel':
      return performLifecycle(database, command, command.action, now);
    case 'audit':
      return command.module === 'intent-orders'
        ? auditIntent(database, command, 'audit', now)
        : performLifecycle(database, command, 'audit', now);
    case 'special-approve':
      return command.module === 'credit-approvals'
        ? approveCredit(database, command, now)
        : auditIntent(database, command, 'special-approve', now);
    case 'push-order': return auditIntent(database, command, 'push-order', now);
    case 'release-batch': return releaseBatch(database, command, now);
    case 'scan-report': return performScan(database, command, now);
    case 'package': return createPackage(database, command, now);
    case 'stock-in':
    case 'stock-out':
    case 'transfer': return performStock(database, command, command.action, now);
    case 'reconcile': return reconcile(database, command, now);
    case 'allocate-cost': return allocateCost(database, command, now);
    case 'retry-sync': return retrySync(database, command, now);
    case 'permission-change': return changePermission(database, command, now);
    case 'start-task': return performLifecycle(database, command, 'start', now);
    case 'complete-task': return completeProductionTask(database, command, now);
    case 'create-intent': return createIntent(database, command, now);
    case 'schedule': return scheduleOrders(database, command, now);
    case 'change-order': return changeOrder(database, command, now);
    case 'approve-cost': return approveCost(database, command, now);
    case 'user-admin': return administerUser(database, command, now);
    case 'role-admin': return administerRole(database, command, now);
    case 'reset-demo': return resetCandidate(database, command.actor, now);
    case 'read':
    case 'supervise': return success('读取成功', [], []);
  }
}

function validateIdRequirement(requirement: IdRequirement, ids: string[]): string | undefined {
  if (requirement === 'none' && ids.length !== 0) return '该操作不接受业务 ID';
  if (requirement === 'one' && ids.length !== 1) return '该操作需要至少一个且只能指定一个业务 ID';
  if (requirement === 'many' && ids.length === 0) return '该操作需要至少一个业务 ID';
  return undefined;
}

function filterRecords(
  records: BusinessRecord[],
  query: ListQuery,
  database: MockDatabase,
  applyDataScope = true,
): BusinessRecord[] {
  let result = records;
  if (query.access && applyDataScope) {
    result = filterByDataScope(query.access.role, result, query.access, database.roleOverrides);
  }
  if (query.keyword?.trim()) {
    const keyword = query.keyword.trim().toLocaleLowerCase('zh-CN');
    result = result.filter((row) =>
      `${row.number} ${row.title} ${JSON.stringify(row.data)}`.toLocaleLowerCase('zh-CN').includes(keyword),
    );
  }
  if (query.status) result = result.filter((row) => row.status === query.status);
  if (query.organizationId) result = result.filter((row) => row.organizationId === query.organizationId);
  if (query.auditActor?.trim()) {
    const actor = query.auditActor.trim().toLocaleLowerCase('zh-CN');
    result = result.filter((row) =>
      String(row.data.actorName ?? '').toLocaleLowerCase('zh-CN').includes(actor));
  }
  if (query.auditAction) {
    if (!isCommandAction(query.auditAction) && query.auditAction !== 'role-switch') return [];
    result = result.filter((row) => row.data.action === query.auditAction);
  }
  if (query.auditResult) {
    if (query.auditResult !== 'success' && query.auditResult !== 'failed') return [];
    result = result.filter((row) => row.data.result === query.auditResult);
  }
  if (query.auditDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.auditDate)) return [];
    result = result.filter((row) => row.updatedAt.slice(0, 10) === query.auditDate);
  }
  return result;
}

const INTEGRATION_AUDIT_ACTIONS = new Set<AuditEvent['action']>(['retry-sync', 'push-order']);
const SECURITY_AUDIT_ACTIONS = new Set<AuditEvent['action']>([
  'permission-change', 'user-admin', 'role-admin', 'reset-demo', 'role-switch',
]);

function uniqueAuditSource(
  records: readonly BusinessRecord[],
  event: AuditEvent,
  aliases: (record: BusinessRecord) => readonly unknown[] = (record) => [record.id, record.number],
): BusinessRecord | undefined {
  const matches = records.filter((record) => aliases(record).includes(event.recordId));
  return matches.length === 1 ? matches[0] : undefined;
}

function allowedAuditSourceModules(action: AuditEvent['action']): AuditSourceModule[] {
  switch (action) {
    case 'submit': case 'audit':
      return ['intent-orders', 'sales-orders', 'order-changes'];
    case 'cancel':
      return ['intent-orders', 'sales-orders', 'order-changes', 'production-tasks'];
    case 'start': case 'complete': return ['sales-orders', 'production-tasks', 'sync-jobs'];
    case 'special-approve': return ['intent-orders', 'credit-approvals'];
    case 'create-intent': case 'push-order': case 'schedule': return ['intent-orders'];
    case 'change-order': return ['order-changes'];
    case 'release-batch': return ['batches'];
    case 'start-task': case 'complete-task': return ['production-tasks'];
    case 'scan-report': return ['reporting'];
    case 'package': return ['packaging'];
    case 'stock-in': return ['inbound'];
    case 'stock-out': return ['outbound'];
    case 'transfer': return ['transfers'];
    case 'retry-sync': return ['sync-jobs'];
    case 'reconcile': return ['reconciliations'];
    case 'allocate-cost': case 'approve-cost': return ['cost-collections'];
    case 'user-admin': case 'role-switch': case 'reset-demo': return ['users'];
    case 'role-admin': case 'permission-change': return ['roles'];
    case 'read': case 'supervise': return [];
  }
}

export function hasAuthoritativeAuditSource(
  event: Pick<AuditEvent, 'action' | 'sourceModule'>,
): boolean {
  return allowedAuditSourceModules(event.action).includes(event.sourceModule);
}

function sourceModuleForCommand(
  module: RecordModule | WorkbenchModule,
  action: AuditEvent['action'],
): AuditSourceModule {
  if (AUDIT_SOURCE_MODULES.includes(module as AuditSourceModule)) {
    return module as AuditSourceModule;
  }
  if (module === 'schedule') return 'intent-orders';
  if (module === 'stock') {
    if (action === 'stock-in') return 'inbound';
    if (action === 'stock-out') return 'outbound';
    return 'transfers';
  }
  if (module === 'allocation') return 'cost-collections';
  if (module === 'permissions') return action === 'reset-demo' ? 'users' : 'roles';
  return allowedAuditSourceModules(action)[0] ?? 'users';
}

function auditSourceRecords(database: MockDatabase, module: AuditSourceModule): BusinessRecord[] {
  if (module === 'batches' || module === 'reporting' || module === 'packaging') {
    return database.workbenches[module].records as BusinessRecord[];
  }
  return database.records[module];
}

function authoritativeAuditSource(
  database: MockDatabase,
  event: AuditEvent,
): BusinessRecord | undefined {
  if (!hasAuthoritativeAuditSource(event)) return undefined;
  if (event.action === 'role-switch' || event.action === 'reset-demo') {
    const actors = database.records.users.filter((record) => record.id === event.actor.userId);
    return actors.length === 1 ? actors[0] : undefined;
  }
  const aliases = event.action === 'permission-change'
    ? (record: BusinessRecord) => [record.id, record.number, record.data.role]
    : undefined;
  return uniqueAuditSource(auditSourceRecords(database, event.sourceModule), event, aliases);
}

function auditRecords(
  database: MockDatabase,
  category: NonNullable<ListQuery['auditCategory']>,
): BusinessRecord[] {
  return database.auditEvents.filter((event) => {
    if (category === 'integration') return INTEGRATION_AUDIT_ACTIONS.has(event.action);
    return SECURITY_AUDIT_ACTIONS.has(event.action);
  }).flatMap((event) => {
    const domain = INTEGRATION_AUDIT_ACTIONS.has(event.action) ? 'integration' : 'security';
    const source = authoritativeAuditSource(database, event);
    if (!source) return [];
    return [{
      id: event.id, number: event.id, title: event.message, domain,
      status: event.result === 'success' ? 'completed' : 'validation-failed',
      organizationId: source?.organizationId ?? 'ORG-01',
      ...(source?.factoryId === undefined ? {} : { factoryId: source.factoryId }),
      ...(source?.warehouseId === undefined ? {} : { warehouseId: source.warehouseId }),
      ...(source?.ownerId === undefined ? {} : { ownerId: source.ownerId }),
      updatedAt: event.occurredAt,
      audit: [clone(event)],
      data: {
        recordId: event.recordId, action: event.action, actorName: event.actor.name,
        actorRole: event.actor.role, result: event.result, message: event.message,
        occurredAt: event.occurredAt,
      },
    }];
  });
}

function workbenchRecords(database: MockDatabase, module: WorkbenchModule): BusinessRecord[] {
  if (module === 'schedule') return database.records['intent-orders'];
  if (module === 'integration-monitor') return database.records['sync-jobs'];
  if (module === 'allocation') return database.records['cost-collections'];
  if (module === 'permissions') return database.records.roles;
  if (module === 'stock') return [...database.records.inbound, ...database.records.outbound, ...database.records.transfers];
  if (module === 'capacity') return database.workbenches.batches.records as BusinessRecord[];
  return database.workbenches[module].records as BusinessRecord[];
}

function integrationSystems(database: MockDatabase): Record<string, unknown>[] {
  const templates = database.workbenches['integration-monitor'].systems as Record<string, unknown>[];
  const templateByName = new Map(templates.map((template) => [String(template.name), template]));
  const names = [
    ...new Set(
      database.records['sync-jobs']
        .map((record) => record.data.system)
        .filter(isNonEmptyString),
    ),
  ];
  return names.map((name) => {
    const template = templateByName.get(name);
    const jobs = database.records['sync-jobs'].filter((record) => record.data.system === name);
    const failures = jobs.filter((record) => record.status === 'sync-failed').length;
    return {
      name,
      throughput: isNonNegativeNumber(template?.throughput) ? template.throughput : 0,
      healthy: failures === 0,
      failures,
    };
  });
}

export function createMockEnterpriseRepository(options: MockRepositoryOptions): EnterpriseRepository {
  const delay = options.delay ?? (async () => undefined);
  const now = options.now ?? (() => new Date().toISOString());
  const loaded = loadDatabase(options.storage);
  let database = loaded.database;
  const serializeCandidate = (candidate: MockDatabase): string | undefined => {
    const snapshot = createJsonSafeSnapshot<MockDatabase>(candidate);
    if (snapshot === undefined || !isMockDatabase(snapshot)) return undefined;
    try {
      const serialized = JSON.stringify(snapshot);
      const roundTripped: unknown = JSON.parse(serialized);
      return createJsonSafeSnapshot(roundTripped) !== undefined && isMockDatabase(roundTripped)
        ? serialized
        : undefined;
    } catch {
      return undefined;
    }
  };
  const commitCandidate = (candidate: MockDatabase): boolean => {
    const serialized = serializeCandidate(candidate);
    if (serialized === undefined) return false;
    try {
      options.storage.setItem(MOCK_STORAGE_KEY, serialized);
      database = JSON.parse(serialized) as MockDatabase;
      return true;
    } catch {
      return false;
    }
  };
  if (loaded.recovered) {
    const serialized = serializeCandidate(database);
    if (serialized !== undefined) {
      try {
        options.storage.setItem(MOCK_STORAGE_KEY, serialized);
      } catch {
        // Repository creation has no OperationResult channel; keep the fresh in-memory graph usable.
      }
    }
  }

  return {
    async listRecords(module: RecordModule, query: ListQuery = {}): Promise<ListResult<BusinessRecord>> {
      const querySnapshot = clone(query);
      await delay();
      const rule = COMMAND_MATRIX[module];
      const category = querySnapshot.auditCategory;
      const auditOrder = querySnapshot.auditOrder;
      if (
        auditOrder !== undefined &&
        (module !== 'audits' || auditOrder !== 'latest')
      ) return { data: [], total: 0, success: true };
      if (module === 'audits' && (category !== 'integration' && category !== 'security')) {
        return { data: [], total: 0, success: true };
      }
      if (module === 'audits' && !querySnapshot.access) return { data: [], total: 0, success: true };
      const principal = querySnapshot.access
        ? resolveTrustedAccess(database, querySnapshot.access)
        : undefined;
      if (querySnapshot.access && !principal) return { data: [], total: 0, success: true };
      const readDomain = module === 'audits' ? category as DomainKey : rule.domain;
      if (
        principal &&
        !canAccess(principal.actor.role, readDomain, 'read', database.roleOverrides)
      ) return { data: [], total: 0, success: true };
      const trustedQuery: ListQuery = {
        ...querySnapshot,
        ...(principal ? { access: principal.access } : {}),
      };
      const source = module === 'audits'
        ? auditRecords(database, category as NonNullable<ListQuery['auditCategory']>)
        : database.records[module];
      const filtered = filterRecords(source, trustedQuery, database);
      const ordered = module === 'audits' && auditOrder === 'latest'
        ? [...filtered].sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
        : filtered;
      const total = ordered.length;
      const page = Math.max(1, trustedQuery.page ?? 1);
      const pageSize = Math.max(1, trustedQuery.pageSize ?? (total || 1));
      const start = (page - 1) * pageSize;
      return { data: clone(ordered.slice(start, start + pageSize)), total, success: true };
    },

    async getDashboard(role: RoleKey): Promise<DashboardData> {
      await delay();
      const shipped = database.records.outbound.length;
      const primary = role === 'planner'
        ? { key: 'primary', label: '待排程订单', value: database.records.todos.length, unit: '单', delta: 2 }
        : {
            key: 'primary', label: '集团订单额',
            value: database.records['sales-orders'].reduce((sum, row) => sum + (row.amount ?? 0), 0),
            unit: '元', delta: 8,
          };
      return clone({
        metrics: [
          primary,
          { key: 'production', label: '在制任务', value: database.records['production-tasks'].filter((row) => row.status !== 'completed').length, unit: '项', delta: -1 },
          { key: 'shipped', label: '今日发运', value: shipped, unit: '包', delta: shipped },
          { key: 'reconciliation', label: '待核销', value: database.records.reconciliations.filter((row) => row.status !== 'completed').length, unit: '笔', delta: 1 },
        ],
        trend: [
          { date: '08-18', orders: 24, delivered: 18 },
          { date: '08-19', orders: 31, delivered: 25 },
          { date: '08-20', orders: 28, delivered: 27 },
          { date: '08-21', orders: 36, delivered: 29 },
          { date: '08-22', orders: 34, delivered: 30 + shipped },
        ],
        todos: database.records.todos,
        alerts: database.records.alerts,
      });
    },

    async getWorkbench(module: WorkbenchModule, access?: AccessContext): Promise<Record<string, unknown>> {
      const accessSnapshot = access ? clone(access) : undefined;
      await delay();
      const workbench = clone(database.workbenches[module]);
      const rule = COMMAND_MATRIX[module];
      const principal = accessSnapshot ? resolveTrustedAccess(database, accessSnapshot) : undefined;
      if (accessSnapshot && !principal) return { records: [] };
      if (principal && !canAccess(principal.actor.role, rule.domain, 'read', database.roleOverrides)) {
        return { records: [] };
      }
      const projected = workbenchRecords(database, module);
      workbench.records = principal
        ? filterByDataScope(principal.actor.role, projected, principal.access, database.roleOverrides)
        : clone(projected);
      if (module === 'integration-monitor') workbench.systems = integrationSystems(database);
      return clone(workbench);
    },

    async getRolePolicy(role: RoleKey): Promise<RolePolicy> {
      await delay();
      return clone(database.roleOverrides[role] ?? ROLE_POLICIES[role]);
    },

    async getRolePrincipal(role: RoleKey): Promise<RolePrincipal | undefined> {
      await delay();
      for (const user of database.records.users) {
        if (user.data.enabled !== true || user.data.role !== role) continue;
        const principal = trustedPrincipalFromUser(database, user.id);
        if (principal) return clone(principal);
      }
      return undefined;
    },

    async getAssignableScopes(role: RoleKey): Promise<DataScope[]> {
      await delay();
      return clone(assignableScopesForRole(database, role));
    },

    async perform(command: PerformCommand): Promise<OperationResult> {
      const snapshot = createJsonSafeSnapshot<PerformCommand>(command);
      await delay();
      if (
        !snapshot || !isActor(snapshot.actor) || !isModule(snapshot.module) ||
        !isCommandAction(snapshot.action) || !Array.isArray(snapshot.ids) ||
        !snapshot.ids.every((id) => typeof id === 'string')
      ) return clone(failure('命令或操作人结构无效'));
      const ids = [...new Set(snapshot.ids.map((id) => id.trim()).filter(Boolean))];
      const principal = resolveTrustedActor(database, snapshot.actor);
      if (!principal) return clone(failure('操作人不在可信用户目录或角色不匹配'));
      const normalized: PerformCommand = {
        ...snapshot,
        ids,
        actor: clone(principal.actor),
        ...(snapshot.access ? { access: clone(snapshot.access) } : {}),
      };
      const rule = COMMAND_MATRIX[normalized.module];
      const requirement = rule.actions[normalized.action];
      if (!requirement) return clone(failure(`模块 ${normalized.module} 不支持操作 ${normalized.action}`));
      const idError = validateIdRequirement(requirement, ids);
      if (idError) return clone(failure(idError));
      const accessAction = normalized.action as PermissionAction;
      if (!canAccess(principal.actor.role, rule.domain, accessAction, database.roleOverrides)) {
        const message = `需要权限：${rule.domain}.${normalized.action}`;
        const event = createEvent(
          database, ids[0] ?? normalized.module, normalized.action, normalized.actor,
          now(), 'failed', message, sourceModuleForCommand(normalized.module, normalized.action),
        );
        return clone(failure(message, [event]));
      }
      const accessError = commandAccessError(database, normalized, principal);
      if (accessError) return clone(failure(accessError));
      normalized.access = principal.access;
      const candidate = clone(database);
      const result = dispatchPerform(candidate, normalized, now());
      if (result.success || result.events.some((event) => event.result === 'failed')) {
        if (!commitCandidate(candidate)) {
          return clone(failure('数据序列化或持久化失败'));
        }
      }
      return clone(result);
    },

    async listAuditEvents(): Promise<AuditEvent[]> {
      await delay();
      return clone(database.auditEvents);
    },

    async reset(actor: Actor): Promise<OperationResult> {
      const actorSnapshot = createJsonSafeSnapshot<Actor>(actor);
      await delay();
      const principal = isActor(actorSnapshot) ? resolveTrustedActor(database, actorSnapshot) : undefined;
      if (!principal || !canAccess(principal.actor.role, 'security', 'reset-demo', database.roleOverrides)) {
        const message = '需要权限：security.reset-demo';
        const safeActor = isActor(actorSnapshot)
          ? actorSnapshot
          : { userId: 'invalid', name: '无效操作人', role: 'general' as const };
        const event = createEvent(database, 'mock-database', 'reset-demo', safeActor, now(), 'failed', message);
        return clone(failure(message, [event]));
      }
      const candidate = clone(database);
      const result = resetCandidate(candidate, principal.actor, now());
      if (!commitCandidate(candidate)) return clone(failure('数据序列化或持久化失败'));
      return clone(result);
    },
  };
}
