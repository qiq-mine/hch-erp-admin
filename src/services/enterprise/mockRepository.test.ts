import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_STORAGE_KEY } from '@/config/product';
import type { Actor, BusinessRecord } from '@/domain/types';
import { ROLE_POLICIES } from '@/config/roles';
import { createFixtureDatabase } from './fixtures';
import { createMemoryStorage } from './memoryStorage';
import type { MockStorage } from './memoryStorage';
import {
  COMMAND_MATRIX,
  createMockEnterpriseRepository,
  hasAuthoritativeAuditSource,
} from './mockRepository';
import type { PerformCommand } from './types';

const actor = { userId: 'u-admin', name: '系统管理员', role: 'admin' } as const;
const instant = async () => undefined;
let repo: ReturnType<typeof createMockEnterpriseRepository>;

function requiredRecord(record: BusinessRecord | undefined, message: string): BusinessRecord {
  if (!record) throw new Error(message);
  return record;
}

beforeEach(() => {
  repo = createMockEnterpriseRepository({
    storage: createMemoryStorage(),
    delay: instant,
    now: () => '2026-08-22T12:00:00.000Z',
  });
});

describe('MockEnterpriseRepository Task 8 authoritative audit ordering', () => {
  const adminAccess = {
    role: 'admin' as const,
    actorId: 'u-admin',
    organizationId: 'ORG-01',
  };

  const permissionEvent = (id: string, occurredAt: string) => ({
    id,
    recordId: 'planner',
    action: 'permission-change' as const,
    actor,
    occurredAt,
    result: 'success' as const,
    message: `授权审计-${id}`,
    sourceModule: 'roles' as const,
  });

  it('sorts the filtered authoritative security projection before paging', async () => {
    const database = createFixtureDatabase();
    database.auditEvents = [
      ...Array.from({ length: 25 }, (_, index) => permissionEvent(
        `PERMISSION-${String(index).padStart(2, '0')}`,
        `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      )),
      {
        id: 'INTEGRATION-NEWEST', recordId: 'SYNC-FAIL-001', action: 'retry-sync' as const,
        actor, occurredAt: '2026-08-31T12:00:00.000Z', result: 'success' as const,
        message: '不应进入安全审计页',
        sourceModule: 'sync-jobs' as const,
      },
    ];
    const storage = createMemoryStorage();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(database));
    const repository = createMockEnterpriseRepository({ storage, delay: instant });

    const result = await repository.listRecords('audits', {
      auditCategory: 'security', auditOrder: 'latest', access: adminAccess, page: 1, pageSize: 6,
    });

    expect(result.total).toBe(25);
    expect(result.data.map((row) => row.id)).toEqual([
      'PERMISSION-24', 'PERMISSION-23', 'PERMISSION-22',
      'PERMISSION-21', 'PERMISSION-20', 'PERMISSION-19',
    ]);
  });

  it('uses the audit id as a deterministic descending tie-break', async () => {
    const database = createFixtureDatabase();
    database.auditEvents = ['A', 'C', 'B'].map((suffix) =>
      permissionEvent(`PERMISSION-${suffix}`, '2026-08-22T12:00:00.000Z'));
    const storage = createMemoryStorage();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(database));
    const repository = createMockEnterpriseRepository({ storage, delay: instant });

    const result = await repository.listRecords('audits', {
      auditCategory: 'security', auditOrder: 'latest', access: adminAccess,
    });

    expect(result.data.map((row) => row.id)).toEqual([
      'PERMISSION-C', 'PERMISSION-B', 'PERMISSION-A',
    ]);
  });

  it('fails closed for unsupported or misplaced audit ordering', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    expect(await repository.listRecords('audits', {
      auditCategory: 'security', auditOrder: 'oldest' as never, access: adminAccess,
    })).toEqual({ data: [], total: 0, success: true });
    expect(await repository.listRecords('users', {
      auditOrder: 'latest', access: adminAccess,
    })).toEqual({ data: [], total: 0, success: true });
  });
});

describe('MockEnterpriseRepository Task 9 authoritative audit filters', () => {
  const adminAccess = {
    role: 'admin' as const,
    actorId: 'u-admin',
    organizationId: 'ORG-01',
  };

  it('filters the authorized security projection by actor, action, result, and date', async () => {
    const repository = createMockEnterpriseRepository({
      storage: createMemoryStorage(), delay: instant,
      now: () => '2026-08-23T08:30:00.000Z',
    });
    await repository.perform({
      module: 'permissions', action: 'permission-change', ids: ['planner'], actor,
      access: adminAccess, payload: { policy: ROLE_POLICIES.planner },
    });

    const result = await repository.listRecords('audits', {
      access: adminAccess,
      auditAction: 'permission-change',
      auditActor: '系统管理',
      auditCategory: 'security',
      auditDate: '2026-08-23',
      auditResult: 'success',
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.data).toMatchObject({
      action: 'permission-change', actorName: '系统管理员', result: 'success',
    });
  });

  it('fails closed for invalid audit action, result, or date filters', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    for (const query of [
      { auditAction: 'unknown-action' },
      { auditResult: 'maybe' },
      { auditDate: '2026/08/23' },
    ]) {
      expect(await repository.listRecords('audits', {
        access: adminAccess, auditCategory: 'security', ...query,
      } as never)).toEqual({ data: [], total: 0, success: true });
    }
  });
});

describe('MockEnterpriseRepository Task 9 audit source-module matrix', () => {
  it('emits an authoritative source for every write pair in the command matrix when denied', async () => {
    const generalActor = { userId: 'u-general', name: '总经理', role: 'general' } as const;
    const writePairs = Object.entries(COMMAND_MATRIX).flatMap(([module, rule]) =>
      Object.entries(rule.actions)
        .filter(([action]) => action !== 'read' && action !== 'supervise')
        .map(([action, requirement]) => ({ module, action, requirement })));

    expect(writePairs.length).toBeGreaterThan(30);
    for (const pair of writePairs) {
      const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
      const ids = pair.requirement === 'none' ? [] : ['UNKNOWN-AUTHORITY-TARGET'];
      const result = await repository.perform({
        module: pair.module,
        action: pair.action,
        ids,
        actor: generalActor,
      } as PerformCommand);

      expect(result.success, `${pair.module}.${pair.action} must be denied`).toBe(false);
      expect(result.events, `${pair.module}.${pair.action} must emit one denial`).toHaveLength(1);
      expect(
        hasAuthoritativeAuditSource(result.events[0]),
        `${pair.module}.${pair.action} emitted ${result.events[0]?.sourceModule}`,
      ).toBe(true);
    }
  });

  it('keeps a successful production cancellation authoritative', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    const result = await repository.perform({
      module: 'production-tasks', action: 'cancel', ids: ['PT-260822-0066'], actor,
    });

    expect(result).toMatchObject({ success: true });
    expect(result.events).toEqual([
      expect.objectContaining({
        action: 'cancel', sourceModule: 'production-tasks', result: 'success',
      }),
    ]);
    expect(result.events.every(hasAuthoritativeAuditSource)).toBe(true);
  });

  it('records the actual module for sales, production, and sync lifecycle events', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({ module: 'sales-orders', action: 'start', ids: ['SO-260821-0098'], actor });
    await repository.perform({ module: 'sales-orders', action: 'complete', ids: ['SO-260821-0098'], actor });
    await repository.perform({ module: 'production-tasks', action: 'complete-task', ids: ['PT-260822-0066'], actor });
    await repository.perform({ module: 'sync-jobs', action: 'retry-sync', ids: ['SYNC-FAIL-001'], actor });
    const pairs = (await repository.listAuditEvents()).map((event) => [event.action, event.sourceModule]);
    expect(pairs).toEqual(expect.arrayContaining([
      ['start', 'sales-orders'], ['complete', 'sales-orders'],
      ['complete', 'production-tasks'], ['retry-sync', 'sync-jobs'],
      ['complete', 'sync-jobs'],
    ]));
  });

  it.each([
    ['schedule', { module: 'schedule', action: 'schedule', ids: ['IO-260822-0186'], payload: { workshop: '橡木车间', plannedDate: '2026-08-28' } }, 'intent-orders'],
    ['batch', { module: 'batches', action: 'release-batch', ids: ['B260826-A'] }, 'batches'],
    ['scan', { module: 'reporting', action: 'scan-report', ids: ['UNKNOWN'], payload: { barcode: 'UNKNOWN' } }, 'reporting'],
    ['stock', { module: 'stock', action: 'stock-in', ids: ['UNKNOWN'], payload: { barcode: 'UNKNOWN' } }, 'inbound'],
    ['cost', { module: 'allocation', action: 'allocate-cost', ids: ['CC-2026-08-01'], payload: { totalCents: 10001, weights: [{ id: 'A', weight: 1 }] } }, 'cost-collections'],
    ['permission', { module: 'permissions', action: 'permission-change', ids: ['planner'], payload: { policy: ROLE_POLICIES.planner } }, 'roles'],
    ['user admin', { module: 'users', action: 'user-admin', ids: ['u-sales'], payload: { enabled: false } }, 'users'],
    ['role admin', { module: 'roles', action: 'role-admin', ids: ['ROLE-PLANNER'], payload: { members: 5 } }, 'roles'],
  ] as const)('emits the authoritative source for handler matrix row %s', async (_name, partial, expected) => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({ ...partial, ids: [...partial.ids], actor } as unknown as PerformCommand);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((event) => event.sourceModule === expected)).toBe(true);
  });

  it('tags denied commands with their actual module instead of the action default', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const denied = await repository.perform({
      module: 'sync-jobs', action: 'retry-sync', ids: ['SYNC-FAIL-001'],
      actor: { userId: 'u-sales', name: '销售经理', role: 'sales' },
    });
    expect(denied.events).toEqual([
      expect.objectContaining({ action: 'retry-sync', sourceModule: 'sync-jobs', result: 'failed' }),
    ]);
  });
});

describe('MockEnterpriseRepository Task 8 package-kitting invariant boundary', () => {
  const repositoryWithPackageData = (data: Record<string, unknown>) => {
    const database = createFixtureDatabase();
    const target = requiredRecord(
      (database.workbenches.packaging.records as BusinessRecord[])
        .find((record) => record.number === 'PKG-READY-001'),
      'fixture missing PKG-READY-001',
    );
    target.data = data;
    const storage = createMemoryStorage();
    storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(database));
    return {
      repository: createMockEnterpriseRepository({ storage, delay: instant }),
      storage,
    };
  };

  it('rejects a contradictory persisted kit atomically at the perform boundary', async () => {
    const { repository, storage } = repositoryWithPackageData({
      kittingRate: 1,
      missingParts: [],
      requiredQuantity: 4,
      scannedQuantity: 3,
    });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeDatabase = JSON.parse(beforeStorage ?? '{}');
    const beforePackaging = await repository.getWorkbench('packaging');
    const beforeInbound = await repository.listRecords('inbound');
    const beforeAudits = await repository.listAuditEvents();

    const result = await repository.perform({
      module: 'packaging', action: 'package', ids: ['PKG-READY-001'], actor,
    });

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(await repository.getWorkbench('packaging')).toEqual(beforePackaging);
    expect(await repository.listRecords('inbound')).toEqual(beforeInbound);
    expect(await repository.listAuditEvents()).toEqual(beforeAudits);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    const afterDatabase = JSON.parse(storage.getItem(MOCK_STORAGE_KEY) ?? '{}');
    expect(afterDatabase.workbenches.stock.knownBarcodes)
      .toEqual(beforeDatabase.workbenches.stock.knownBarcodes);
    expect(afterDatabase.workbenches.stock.barcodeScopes)
      .toEqual(beforeDatabase.workbenches.stock.barcodeScopes);
  });

  it.each([
    ['zero required quantity', {
      kittingRate: 1, missingParts: [], requiredQuantity: 0, scannedQuantity: 0,
    }],
    ['omitted quantities', { kittingRate: 1, missingParts: [] }],
  ])('accepts the established completed semantics for %s', async (_case, data) => {
    const { repository } = repositoryWithPackageData(data);

    await expect(repository.perform({
      module: 'packaging', action: 'package', ids: ['PKG-READY-001'], actor,
    })).resolves.toMatchObject({ success: true, message: '包件生成成功' });
  });
});

describe('MockEnterpriseRepository', () => {
  it('reports only data scopes supported by an enabled role user directory entry', async () => {
    expect(await repo.getAssignableScopes('planner')).toEqual(['group', 'organization', 'self']);
    expect(await repo.getAssignableScopes('production')).toEqual(['group', 'organization', 'factory', 'self']);
    expect(await repo.getAssignableScopes('warehouse')).toEqual([
      'group', 'organization', 'factory', 'warehouse', 'self',
    ]);
  });

  it('rejects a permission policy that would leave the target role without a trusted principal', async () => {
    const beforeEvents = await repo.listAuditEvents();
    const result = await repo.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor,
      payload: { policy: { ...ROLE_POLICIES.planner, scope: 'factory' } },
    });

    expect(result).toMatchObject({ success: false, message: '目标角色没有满足工厂数据范围的启用用户' });
    expect(await repo.getRolePolicy('planner')).toEqual(ROLE_POLICIES.planner);
    expect(await repo.listAuditEvents()).toEqual(beforeEvents);
  });

  it('auditing IO-260822-0186 creates a sales order and a planning todo', async () => {
    await repo.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0186'],
      actor,
    });

    expect(
      (await repo.listRecords('sales-orders')).data.some(
        (row) => row.data.sourceNumber === 'IO-260822-0186',
      ),
    ).toBe(true);
    expect(
      (await repo.listRecords('todos')).data.some(
        (row) => row.data.sourceNumber === 'IO-260822-0186',
      ),
    ).toBe(true);
  });

  it('credit-insufficient IO-260822-0185 enters pending-special-approval', async () => {
    await repo.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0185'],
      actor,
    });

    const row = (
      await repo.listRecords('intent-orders', { keyword: 'IO-260822-0185' })
    ).data[0];
    expect(row.status).toBe('pending-special-approval');
  });

  it('rejects overloaded batch release without mutating it', async () => {
    const result = await repo.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260827-C'],
      actor,
      payload: { capacityUsage: 1.12, workshop: '胡桃木车间' },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(
      ((await repo.getWorkbench('batches')).records as BusinessRecord[]).find(
        (row) => row.number === 'B260827-C',
      )?.status,
    ).toBe('audited');
  });

  it('retains failure history after a successful sync retry', async () => {
    await repo.perform({
      module: 'sync-jobs',
      action: 'retry-sync',
      ids: ['SYNC-FAIL-001'],
      actor,
    });

    const row = (
      await repo.listRecords('sync-jobs', { keyword: 'SYNC-FAIL-001' })
    ).data[0];
    expect(row.status).toBe('completed');
    expect(row.audit.map((event) => event.result)).toEqual(
      expect.arrayContaining(['failed', 'success']),
    );
  });

  it('restores fixture counts on reset', async () => {
    const original = (await repo.listRecords('sales-orders')).total;
    await repo.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0186'],
      actor,
    });
    expect((await repo.listRecords('sales-orders')).total).toBe(original + 1);

    await repo.reset(actor);
    expect((await repo.listRecords('sales-orders')).total).toBe(original);
  });

  it('propagates completion through packaging, warehouse, and finance', async () => {
    await repo.perform({
      module: 'production-tasks',
      action: 'complete-task',
      ids: ['PT-260822-0066'],
      actor,
    });
    const packaging = await repo.getWorkbench('packaging');
    expect(
      (packaging.records as BusinessRecord[]).find(
        (row) => row.number === 'PKG-READY-001',
      )?.data.kittingRate,
    ).toBe(1);

    await repo.perform({
      module: 'packaging',
      action: 'package',
      ids: ['PKG-READY-001'],
      actor,
    });
    await repo.perform({
      module: 'stock',
      action: 'stock-out',
      ids: ['PKG-READY-001'],
      actor,
    });

    expect(
      (await repo.listRecords('reconciliations')).data.some(
        (row) => row.data.sourcePackage === 'PKG-READY-001',
      ),
    ).toBe(true);
  });

  it('rejects a planner permission change at the service boundary', async () => {
    const result = await repo.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor: { userId: 'u-planner', name: '计划员', role: 'planner' },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(result.message).toContain('需要权限');
  });

  it('filters warehouse data at the repository boundary', async () => {
    const result = await repo.listRecords('inbound', {
      access: {
        role: 'warehouse',
        actorId: 'u-wh',
        organizationId: 'ORG-01',
        factoryId: 'F-01',
        warehouseId: 'WH-02',
      },
    });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.warehouseId === 'WH-02')).toBe(true);
  });

  it('persists a role override and exposes its authorization audit as a record', async () => {
    const storage = createMemoryStorage();
    const first = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });
    await first.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor,
      payload: {
        policy: {
          ...ROLE_POLICIES.planner,
          domains: [...ROLE_POLICIES.planner.domains, 'integration'],
        },
      },
    });

    const restored = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });
    expect((await restored.getRolePolicy('planner')).domains).toContain('integration');
    expect(
      (await restored.listRecords('audits', {
        auditCategory: 'security',
        access: { role: 'admin', actorId: 'u-admin', organizationId: 'ORG-01' },
      })).data.some(
        (row) =>
          row.data.action === 'permission-change' && row.data.recordId === 'planner',
      ),
    ).toBe(true);
  });

  it('persists successful business mutations across repository instances', async () => {
    const storage = createMemoryStorage();
    const first = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });
    const original = (await first.listRecords('sales-orders')).total;
    await first.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0186'],
      actor,
    });

    const restored = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });
    expect((await restored.listRecords('sales-orders')).total).toBe(original + 1);
  });

  it('keeps a denied permission operation out of persisted audit history', async () => {
    const before = await repo.listAuditEvents();
    await repo.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor: { ...actor, role: 'planner' },
      payload: { policy: { ...ROLE_POLICIES.planner, domains: ['security'] } },
    });

    expect(await repo.getRolePolicy('planner')).toEqual(ROLE_POLICIES.planner);
    expect(await repo.listAuditEvents()).toEqual(before);
  });

  it('allocates integer cents through the repository without losing a cent', async () => {
    await repo.perform({
      module: 'allocation',
      action: 'allocate-cost',
      ids: ['CC-2026-08-01'],
      actor,
      payload: {
        totalCents: 10_001,
        weights: [
          { id: 'A', weight: 2 },
          { id: 'B', weight: 1 },
        ],
      },
    });

    const preview = (await repo.getWorkbench('allocation')).preview as {
      id: string;
      amountCents: number;
    }[];
    expect(preview.map((row) => row.amountCents)).toEqual([6667, 3334]);
    expect(preview.reduce((sum, row) => sum + row.amountCents, 0)).toBe(10_001);
  });

  it('records a rejected capacity release without changing business fields', async () => {
    const before = ((await repo.getWorkbench('batches')).records as BusinessRecord[]).find(
      (row) => row.number === 'B260827-C',
    ) as BusinessRecord;
    await repo.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260827-C'],
      actor,
      payload: { capacityUsage: 1.12, workshop: '胡桃木车间' },
    });
    const after = ((await repo.getWorkbench('batches')).records as BusinessRecord[]).find(
      (row) => row.number === 'B260827-C',
    ) as BusinessRecord;

    expect({ ...after, audit: [] }).toEqual({ ...before, audit: [] });
    expect(after.audit.at(-1)).toMatchObject({
      action: 'release-batch',
      result: 'failed',
    });
  });

  it('creates deep-fresh fixture graphs for reset isolation', () => {
    const first = createFixtureDatabase();
    const firstPackaging = first.workbenches.packaging.records as BusinessRecord[];
    firstPackaging[0].data.kittingRate = 99;
    first.records['intent-orders'][0].data.customer = '被污染的客户';
    first.roleOverrides.planner = {
      ...ROLE_POLICIES.planner,
      domains: ['security'],
    };

    const second = createFixtureDatabase();
    expect(
      (second.workbenches.packaging.records as BusinessRecord[])[0].data.kittingRate,
    ).toBe(0.75);
    expect(second.records['intent-orders'][0].data.customer).toBe('华北家居');
    expect(second.roleOverrides).toEqual({});
  });

  it('awaits the injected delay at every public repository boundary', async () => {
    let delayCalls = 0;
    const delayed = createMockEnterpriseRepository({
      storage: createMemoryStorage(),
      delay: async () => {
        delayCalls += 1;
      },
      now: () => '2026-08-22T12:00:00.000Z',
    });

    await delayed.listRecords('todos');
    await delayed.getDashboard('admin');
    await delayed.getWorkbench('batches');
    await delayed.getRolePolicy('admin');
    await delayed.getRolePrincipal('admin');
    await delayed.getAssignableScopes('admin');
    await delayed.perform({ module: 'todos', action: 'read', ids: [], actor });
    await delayed.listAuditEvents();
    await delayed.reset(actor);

    expect(delayCalls).toBe(9);
  });
});

describe('MockEnterpriseRepository review safety contract', () => {
  it.each([
    ['missing record modules', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.records = {} as typeof database.records;
    }],
    ['non-array workbench records', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.batches.records = 'corrupt';
    }],
    ['invalid role policy override', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.roleOverrides = {
        planner: {
          label: '',
          domains: ['not-a-domain'],
          actions: ['not-an-action'],
          scope: 'not-a-scope',
        },
      } as never;
    }],
    ['invalid audit events', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.auditEvents = [{ result: 'maybe' }] as never;
    }],
  ])('recovers and overwrites storage containing %s', async (_name, corrupt) => {
    const database = createFixtureDatabase();
    corrupt(database);
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    const recovered = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });

    expect((await recovered.listRecords('intent-orders')).total).toBe(3);
    expect(((await recovered.getWorkbench('batches')).records as unknown[])).toHaveLength(2);
    expect(await recovered.getRolePolicy('planner')).toEqual(ROLE_POLICIES.planner);
    expect((await recovered.listAuditEvents()).every((event) => event.result !== ('maybe' as never))).toBe(true);
    const persisted = JSON.parse(storage.getItem(MOCK_STORAGE_KEY) ?? '{}');
    expect(Array.isArray(persisted.records['intent-orders'])).toBe(true);
    expect(Array.isArray(persisted.workbenches.batches.records)).toBe(true);
    expect(persisted.roleOverrides).toEqual({});
  });

  it('retains a structurally legal persisted role-switch audit event', async () => {
    const database = createFixtureDatabase();
    database.auditEvents.push({
      id: 'ROLE-SWITCH-1',
      recordId: 'u-admin',
      action: 'role-switch',
      actor,
      occurredAt: '2026-08-22T12:00:00.000Z',
      result: 'success',
      message: '切换至计划员视角',
      sourceModule: 'users',
    });
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    const repository = createMockEnterpriseRepository({ storage, delay: instant });

    expect((await repository.listAuditEvents()).some((event) => event.id === 'ROLE-SWITCH-1')).toBe(true);
  });

  it('snapshots ids, payload, and actor before awaiting the injected delay', async () => {
    let releaseDelay: (() => void) | undefined;
    const delayed = createMockEnterpriseRepository({
      storage: createMemoryStorage(),
      delay: () => new Promise<void>((resolve) => {
        releaseDelay = resolve;
      }),
      now: () => '2026-08-22T12:00:00.000Z',
    });
    const command: PerformCommand = {
      module: 'batches',
      action: 'release-batch',
      ids: ['B260826-A'],
      actor: { userId: 'u-admin', name: '原始管理员', role: 'admin' },
      payload: { capacityUsage: 0.76, workshop: '橡木车间' },
    };

    const pending = delayed.perform(command);
    command.ids[0] = 'B260827-C';
    command.actor.name = '被篡改的管理员';
    if (command.payload) command.payload.capacityUsage = 1.12;
    releaseDelay?.();
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.affectedIds).toEqual(['B260826-A']);
    expect(result.events[0].actor.name).toBe('系统管理员');
  });

  it('deduplicates ids before applying a mutation', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'reconciliations',
      action: 'reconcile',
      ids: ['REC-260822-0031', 'REC-260822-0031'],
      actor,
    });

    expect(result.affectedIds).toEqual(['REC-260822-0031']);
    expect(result.events).toHaveLength(1);
  });

  it('rejects empty ids for a targeted action', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'batches',
      action: 'release-batch',
      ids: [],
      actor,
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(result.message).toContain('至少一个');
  });

  it('rolls back every business and audit change when one id in a multi-id command fails', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const beforeAudit = await repository.listAuditEvents();
    const result = await repository.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0186', 'IO-NOT-FOUND'],
      actor,
    });

    expect(result.success).toBe(false);
    expect((await repository.listRecords('sales-orders')).data.some(
      (row) => row.data.sourceNumber === 'IO-260822-0186',
    )).toBe(false);
    expect((await repository.listRecords('intent-orders', { keyword: 'IO-260822-0186' })).data[0].status).toBe('submitted');
    expect(await repository.listAuditEvents()).toEqual(beforeAudit);
  });

  it('commits only the failed trace when a traceable multi-id retry is rejected', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'sync-jobs',
      action: 'retry-sync',
      ids: ['SYNC-FAIL-001', 'SYNC-NOT-FOUND'],
      actor,
    });

    expect(result.success).toBe(false);
    expect((await repository.listRecords('sync-jobs', { keyword: 'SYNC-FAIL-001' })).data[0].status).toBe('sync-failed');
    const audits = await repository.listAuditEvents();
    expect(audits.some((event) => event.recordId === 'SYNC-NOT-FOUND' && event.result === 'failed')).toBe(true);
    expect(audits.filter((event) => event.recordId === 'SYNC-FAIL-001')).toHaveLength(1);
  });

  it('rejects a module/action mismatch without changing allocation data', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'todos',
      action: 'allocate-cost',
      ids: ['CC-2026-08-01'],
      actor,
      payload: { totalCents: 10_001, weights: [{ id: 'A', weight: 1 }] },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(result.message).toContain('不支持操作');
    expect((await repository.getWorkbench('allocation')).preview).toBeUndefined();
  });

  it.each([
    ['unknown module', { module: '__proto__', action: 'read', ids: [], actor }],
    ['non-string id', { module: 'batches', action: 'release-batch', ids: [7], actor }],
  ])('returns a validation failure for a malformed runtime command: %s', async (_name, command) => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    await expect(repository.perform(command as never)).resolves.toMatchObject({
      success: false,
      affectedIds: [],
    });
  });

  it('rejects a repeated stock-in and keeps a single authoritative completed record', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const first = await repository.perform({
      module: 'stock',
      action: 'stock-in',
      ids: ['PKG-INBOUND-001'],
      actor,
    });
    const second = await repository.perform({
      module: 'stock',
      action: 'stock-in',
      ids: ['PKG-INBOUND-001'],
      actor,
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, affectedIds: [] });
    expect(second.message).toBe('重复扫码');
    const inbound = (await repository.listRecords('inbound')).data.filter(
      (row) => row.number === 'PKG-INBOUND-001',
    );
    expect(inbound).toHaveLength(1);
    expect(inbound[0].status).toBe('completed');
    expect(((await repository.getWorkbench('stock')).seenBarcodes as string[])).toContain('PKG-INBOUND-001');
  });

  it('updates the original transfer record instead of reporting a no-op success', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'stock',
      action: 'transfer',
      ids: ['TR-260822-0003'],
      actor,
      payload: { targetWarehouseId: 'WH-01' },
    });

    expect(result.success).toBe(true);
    const transfer = (await repository.listRecords('transfers', { keyword: 'TR-260822-0003' })).data[0];
    expect(transfer.status).toBe('completed');
    expect(transfer.data.targetWarehouseId).toBe('WH-01');
    expect(transfer.audit.at(-1)?.action).toBe('transfer');
  });

  it('special-approves a credit record and atomically advances its linked intent', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'credit-approvals',
      action: 'special-approve',
      ids: ['CA-260822-0012'],
      actor,
    });

    expect(result.success).toBe(true);
    expect((await repository.listRecords('credit-approvals', { keyword: 'CA-260822-0012' })).data[0].status).toBe('audited');
    expect((await repository.listRecords('intent-orders', { keyword: 'IO-260822-0185' })).data[0].status).toBe('audited');
    expect((await repository.listRecords('sales-orders')).data.some(
      (row) => row.data.sourceNumber === 'IO-260822-0185',
    )).toBe(true);
    expect((await repository.listRecords('todos')).data.some(
      (row) => row.data.sourceNumber === 'IO-260822-0185',
    )).toBe(true);
    expect(result.events.map((event) => event.recordId)).toEqual(
      expect.arrayContaining(['CA-260822-0012', 'IO-260822-0185']),
    );
  });

  it('deep-snapshots persisted actors and reset results', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const mutableActor: Actor = { userId: 'u-admin', name: '原始管理员', role: 'admin' };
    await repository.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260826-A'],
      actor: mutableActor,
    });
    mutableActor.name = '外部篡改';
    expect((await repository.listAuditEvents()).at(-1)?.actor.name).toBe('系统管理员');

    const resetResult = await repository.reset(mutableActor);
    resetResult.events[0].message = '篡改结果';
    resetResult.events[0].actor.name = '篡改 actor';
    const resetAudit = (await repository.listAuditEvents()).at(-1);
    expect(resetAudit?.message).toBe('演示数据已重置');
    expect(resetAudit?.actor.name).toBe('系统管理员');
  });

  it.each([
    ['prototype role id', '__proto__', { policy: ROLE_POLICIES.planner }],
    ['null policy', 'planner', { policy: null }],
    ['blank label', 'planner', { policy: { ...ROLE_POLICIES.planner, label: '' } }],
    ['invalid domain', 'planner', { policy: { ...ROLE_POLICIES.planner, domains: ['root'] } }],
    ['invalid action', 'planner', { policy: { ...ROLE_POLICIES.planner, actions: ['sudo'] } }],
    ['invalid scope', 'planner', { policy: { ...ROLE_POLICIES.planner, scope: 'global-root' } }],
    ['extra policy field', 'planner', { policy: { ...ROLE_POLICIES.planner, elevated: true } }],
  ])('rejects malformed permission payload: %s', async (_name, role, payload) => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const before = await repository.getRolePolicy('planner');
    const result = await repository.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: [role],
      actor,
      payload: payload as never,
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(await repository.getRolePolicy('planner')).toEqual(before);
  });

  it('schedules an intent with observable planning data', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'schedule',
      action: 'schedule',
      ids: ['IO-260822-0186'],
      actor,
      payload: { workshop: '橡木车间', plannedDate: '2026-08-28' },
    });
    const intent = (await repository.listRecords('intent-orders', { keyword: 'IO-260822-0186' })).data[0];
    expect(intent.data).toMatchObject({ workshop: '橡木车间', plannedDate: '2026-08-28' });
    expect(intent.audit.at(-1)?.action).toBe('schedule');
  });

  it('applies an order change to its fixture record', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'order-changes',
      action: 'change-order',
      ids: ['OC-260822-0007'],
      actor,
      payload: { changes: { reason: '客户调整', deliveryDate: '2026-09-10' } },
    });
    const change = (await repository.listRecords('order-changes')).data[0];
    expect(change.data.changes).toEqual({ reason: '客户调整', deliveryDate: '2026-09-10' });
    expect(change.audit.at(-1)?.action).toBe('change-order');
  });

  it.each([
    ['blank reason', { reason: '  ', deliveryDate: '2026-09-10' }],
    ['invalid calendar date', { reason: '调整', deliveryDate: '2026-02-30' }],
    ['zero quantity', { reason: '调整', deliveryDate: '2026-09-10', quantityDelta: 0 }],
    ['fractional quantity', { reason: '调整', deliveryDate: '2026-09-10', quantityDelta: 1.5 }],
    ['out-of-range quantity', { reason: '调整', deliveryDate: '2026-09-10', quantityDelta: 1_000_001 }],
  ])('rejects strict order-change schema atomically: %s', async (_name, changes) => {
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const before = (await repository.listRecords('order-changes')).data[0];
    const audits = await repository.listAuditEvents();
    expect(await repository.perform({
      module: 'order-changes', action: 'change-order', ids: ['OC-260822-0007'], actor,
      payload: { changes },
    })).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect((await repository.listRecords('order-changes')).data[0]).toEqual(before);
    expect(await repository.listAuditEvents()).toEqual(audits);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
  });

  it('completes a cost collection on approval', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'cost-collections',
      action: 'approve-cost',
      ids: ['CC-2026-08-01'],
      actor,
    });
    const collection = (await repository.listRecords('cost-collections')).data[0];
    expect(collection.status).toBe('completed');
    expect(collection.audit.at(-1)?.action).toBe('approve-cost');
  });

  it('updates a user with validated administration payload', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'users',
      action: 'user-admin',
      ids: ['u-sales'],
      actor,
      payload: { enabled: false, role: 'planner' },
    });
    const user = (await repository.listRecords('users', { keyword: 'u-sales' })).data[0];
    expect(user.data).toMatchObject({ enabled: false, role: 'planner' });
    expect(user.audit.at(-1)?.action).toBe('user-admin');
  });

  it('updates a role with validated administration payload', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'roles',
      action: 'role-admin',
      ids: ['ROLE-PLANNER'],
      actor,
      payload: { members: 5, responsibility: '统筹排程与合批投放' },
    });
    const role = (await repository.listRecords('roles', { keyword: 'ROLE-PLANNER' })).data[0];
    expect(role.data).toMatchObject({ members: 5, responsibility: '统筹排程与合批投放' });
    expect(role.audit.at(-1)?.action).toBe('role-admin');
  });

  it.each([
    ['create intent', { module: 'intent-orders', action: 'create-intent', ids: [], actor }],
    ['schedule', { module: 'schedule', action: 'schedule', ids: ['IO-260822-0186'], actor }],
    ['change order', { module: 'order-changes', action: 'change-order', ids: ['OC-260822-0007'], actor }],
    ['user administration', { module: 'users', action: 'user-admin', ids: ['u-sales'], actor }],
    ['role administration', { module: 'roles', action: 'role-admin', ids: ['ROLE-PLANNER'], actor }],
  ] satisfies [string, PerformCommand][])('rejects %s without its required payload', async (_name, command) => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const before = await repository.listAuditEvents();
    const result = await repository.perform(command);

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(await repository.listAuditEvents()).toEqual(before);
  });

  it('keeps sync and intent authority consistent in their workbench projections', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'sync-jobs',
      action: 'retry-sync',
      ids: ['SYNC-FAIL-001'],
      actor,
    });
    expect(((await repository.getWorkbench('integration-monitor')).records as BusinessRecord[]).find(
      (row) => row.number === 'SYNC-FAIL-001',
    )?.status).toBe('completed');

    await repository.perform({
      module: 'intent-orders',
      action: 'audit',
      ids: ['IO-260822-0186'],
      actor,
    });
    expect(((await repository.getWorkbench('schedule')).records as BusinessRecord[]).find(
      (row) => row.number === 'IO-260822-0186',
    )?.status).toBe('audited');
  });

  it('returns empty reads when the access role lacks the real module read permission', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const access = {
      role: 'planner' as const,
      actorId: 'u-planner',
      organizationId: 'ORG-01',
      factoryId: 'F-01',
      warehouseId: 'WH-02',
    };

    expect(await repository.listRecords('users', { access })).toEqual({
      data: [],
      total: 0,
      success: true,
    });
    expect((await repository.getWorkbench('permissions', access)).records).toEqual([]);
  });
});

describe('MockEnterpriseRepository workbench schema recovery', () => {
  it.each([
    ['reporting successfulScans', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.reporting.successfulScans = 'not-an-array';
    }],
    ['reporting seenBarcodes members', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.reporting.seenBarcodes = ['VALID', 7];
    }],
    ['packaging seenBarcodes', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.packaging.seenBarcodes = 'not-an-array';
    }],
    ['stock seenBarcodes members', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.stock.seenBarcodes = [false];
    }],
    ['reporting knownBarcodes object', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.reporting.knownBarcodes = [];
    }],
    ['reporting barcode process', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.reporting.knownBarcodes = {
        BROKEN: { process: 'painting', kitted: true, outbound: false },
      };
    }],
    ['stock barcode kitted flag', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.stock.knownBarcodes = {
        BROKEN: { process: 'outbound', kitted: 'yes', outbound: false },
      };
    }],
    ['stock barcode outbound flag', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.stock.knownBarcodes = {
        BROKEN: { process: 'outbound', kitted: true, outbound: 1 },
      };
    }],
    ['schedule workshop', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.schedule.workshop = 9;
    }],
    ['schedule capacity', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.schedule.dailyCapacity = 'large';
    }],
    ['capacity days array', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.capacity.days = {};
    }],
    ['capacity day entry', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.capacity.days = [{ date: '2026-08-27', workshop: '胡桃木车间', usage: '112%' }];
    }],
    ['allocation weights', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.allocation.weights = [{ id: 'A', weight: Number.NaN }];
    }],
    ['allocation preview', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.allocation.preview = [{ id: 'A', weight: 1, amountCents: 1.5 }];
    }],
    ['analysis customer profit', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.analysis.customerProfit = [{ customer: '', revenue: '236000', profitRate: 0.23 }];
    }],
    ['analysis expense variance', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.analysis.expenseVariance = [{ item: '制造费用', budget: null, actual: 84600 }];
    }],
    ['integration systems', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches['integration-monitor'].systems = [{ name: 'WMS', healthy: 'no', throughput: 84, failures: 1 }];
    }],
    ['sync mappings', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches['sync-mappings'].mappings = [{ source: 'CRM.Order', target: '', rule: 7, enabled: true }];
    }],
    ['permission policies', (database: ReturnType<typeof createFixtureDatabase>) => {
      database.workbenches.permissions.policies = { planner: { ...ROLE_POLICIES.planner, scope: 'root' } };
    }],
  ])('recovers a persisted database with invalid %s metadata', async (_name, corrupt) => {
    const database = createFixtureDatabase();
    database.workbenches.reporting.corruptionMarker = true;
    corrupt(database);
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    const repository = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });

    const persisted = JSON.parse(storage.getItem(MOCK_STORAGE_KEY) ?? '{}');
    expect(persisted.workbenches.reporting.corruptionMarker).toBeUndefined();
    expect(persisted.workbenches.reporting.seenBarcodes).toEqual(['PKG-260822-DUP']);
    await expect(repository.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260826-A'],
      actor,
    })).resolves.toMatchObject({ success: true });
  });

  it('derives integration system health from authoritative sync records', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'sync-jobs',
      action: 'retry-sync',
      ids: ['SYNC-FAIL-001'],
      actor,
    });

    const systems = (await repository.getWorkbench('integration-monitor')).systems as {
      name: string;
      healthy: boolean;
      failures: number;
    }[];
    expect(systems.find((system) => system.name === 'WMS')).toMatchObject({
      healthy: true,
      failures: 0,
    });
  });

  it('does not expose a monitor-only system without an authoritative sync record', async () => {
    const database = createFixtureDatabase();
    (database.workbenches['integration-monitor'].systems as Record<string, unknown>[]).push({
      name: 'GHOST',
      healthy: false,
      throughput: 0,
      failures: 9,
    });
    const repository = createMockEnterpriseRepository({
      storage: createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) }),
      delay: instant,
    });

    const systems = (await repository.getWorkbench('integration-monitor')).systems as {
      name: string;
    }[];
    expect(systems.map((system) => system.name)).toEqual(['CRM', 'WMS']);
  });

  it('projects capacity batches from the authoritative batch workbench', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260826-A'],
      actor,
    });

    const records = (await repository.getWorkbench('capacity')).records as BusinessRecord[];
    expect(records.find((row) => row.number === 'B260826-A')?.status).toBe('executing');
  });
});

describe('MockEnterpriseRepository business data schema recovery', () => {
  const persistedDataCorruptions: [
    string,
    (database: ReturnType<typeof createFixtureDatabase>) => void,
  ][] = [
    ['packaging missingParts', (database) => {
      const record = (database.workbenches.packaging.records as BusinessRecord[])
        .find((row) => row.number === 'PKG-READY-001') as BusinessRecord;
      record.data.missingParts = 7;
    }],
    ['packaging kittingRate', (database) => {
      const record = (database.workbenches.packaging.records as BusinessRecord[])
        .find((row) => row.number === 'PKG-READY-001') as BusinessRecord;
      record.data.kittingRate = '75%';
    }],
    ['packaging requiredQuantity', (database) => {
      const record = (database.workbenches.packaging.records as BusinessRecord[])
        .find((row) => row.number === 'PKG-READY-001') as BusinessRecord;
      record.data.requiredQuantity = '4';
    }],
    ['packaging scannedQuantity', (database) => {
      const record = (database.workbenches.packaging.records as BusinessRecord[])
        .find((row) => row.number === 'PKG-READY-001') as BusinessRecord;
      record.data.scannedQuantity = false;
    }],
    ['todo sourceNumber', (database) => {
      database.records.todos[0].data.sourceNumber = 101;
    }],
    ['sales order sourceNumber', (database) => {
      database.records['sales-orders'][0].data.sourceNumber = false;
    }],
    ['credit approval sourceNumber', (database) => {
      database.records['credit-approvals'][0].data.sourceNumber = null;
    }],
    ['reconciliation sourcePackage', (database) => {
      database.records.reconciliations[0].data.sourcePackage = [];
    }],
    ['sync system', (database) => {
      database.records['sync-jobs'][0].data.system = { name: 'CRM' };
    }],
    ['sync attempts', (database) => {
      database.records['sync-jobs'][1].data.attempts = 'one';
    }],
    ['cost weights collection', (database) => {
      database.records['cost-collections'][0].data.weights = { A: 2 };
    }],
    ['cost weight item', (database) => {
      database.records['cost-collections'][0].data.weights = [{ id: 'A', weight: 'heavy' }];
    }],
    ['cost totalCents', (database) => {
      database.records['cost-collections'][0].data.totalCents = '10001';
    }],
    ['batch capacityUsage', (database) => {
      (database.workbenches.batches.records as BusinessRecord[])[0].data.capacityUsage = '76%';
    }],
    ['batch workshop', (database) => {
      (database.workbenches.batches.records as BusinessRecord[])[0].data.workshop = ['橡木车间'];
    }],
    ['production packageNumber', (database) => {
      database.records['production-tasks'][0].data.packageNumber = { id: 'PKG-READY-001' };
    }],
    ['transfer targetWarehouseId', (database) => {
      database.records.transfers[0].data.targetWarehouseId = 1;
    }],
    ['intent creditSufficient', (database) => {
      database.records['intent-orders'][1].data.creditSufficient = 'false';
    }],
    ['user enabled flag', (database) => {
      database.records.users[0].data.enabled = 1;
    }],
    ['user role', (database) => {
      database.records.users[0].data.role = 'root';
    }],
    ['role members', (database) => {
      database.records.roles[0].data.members = 'two';
    }],
    ['reporting barcode', (database) => {
      (database.workbenches.reporting.records as BusinessRecord[])[0].data.barcode = 42;
    }],
  ];

  it.each(persistedDataCorruptions)(
    'recovers, overwrites storage, and remains operable for invalid %s',
    async (_name, corrupt) => {
      const database = createFixtureDatabase();
      database.workbenches.reporting.corruptionMarker = true;
      corrupt(database);
      const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
      const repository = createMockEnterpriseRepository({
        storage,
        delay: instant,
        now: () => '2026-08-22T12:00:00.000Z',
      });

      const persisted = JSON.parse(storage.getItem(MOCK_STORAGE_KEY) ?? '{}');
      expect(persisted.workbenches.reporting.corruptionMarker).toBeUndefined();
      expect(
        persisted.workbenches.packaging.records.find(
          (row: BusinessRecord) => row.number === 'PKG-READY-001',
        ).data,
      ).toMatchObject({
        kittingRate: 0.75,
        missingParts: ['门板 × 1'],
        requiredQuantity: 4,
        scannedQuantity: 3,
      });

      await expect(repository.perform({
        module: 'production-tasks',
        action: 'complete-task',
        ids: ['PT-260822-0066'],
        actor,
      })).resolves.toMatchObject({ success: true });
      await expect(repository.perform({
        module: 'packaging',
        action: 'package',
        ids: ['PKG-READY-001'],
        actor,
      })).resolves.toMatchObject({ success: true });
    },
  );

  it('accepts and reloads the complete set of handler-produced business data', async () => {
    const storage = createMemoryStorage();
    const first = createMockEnterpriseRepository({
      storage,
      delay: instant,
      now: () => '2026-08-22T12:00:00.000Z',
    });
    await first.perform({
      module: 'production-tasks', action: 'complete-task', ids: ['PT-260822-0066'], actor,
    });
    await first.perform({
      module: 'packaging', action: 'package', ids: ['PKG-READY-001'], actor,
    });
    await first.perform({
      module: 'stock', action: 'stock-out', ids: ['PKG-READY-001'], actor,
    });
    await first.perform({
      module: 'sync-jobs', action: 'retry-sync', ids: ['SYNC-FAIL-001'], actor,
    });
    await first.perform({
      module: 'schedule', action: 'schedule', ids: ['IO-260822-0186'], actor,
      payload: { workshop: '橡木车间', plannedDate: '2026-08-28' },
    });
    await first.perform({
      module: 'order-changes', action: 'change-order', ids: ['OC-260822-0007'], actor,
      payload: { changes: { reason: '客户调整', deliveryDate: '2026-09-10' } },
    });
    await first.perform({
      module: 'intent-orders', action: 'create-intent', ids: [], actor,
      payload: {
        number: 'IO-RELOAD-001', title: '重载验证订购意向', customer: '重载客户',
        amount: 88_000, creditSufficient: true,
      },
    });
    await first.perform({
      module: 'allocation', action: 'allocate-cost', ids: ['CC-2026-08-01'], actor,
      payload: { totalCents: 10_001, weights: [{ id: 'A', weight: 2 }, { id: 'B', weight: 1 }] },
    });
    await first.perform({
      module: 'users', action: 'user-admin', ids: ['u-sales'], actor,
      payload: { enabled: false, role: 'planner' },
    });
    await first.perform({
      module: 'roles', action: 'role-admin', ids: ['ROLE-PLANNER'], actor,
      payload: { members: 5, responsibility: '重载验证职责' },
    });

    const restored = createMockEnterpriseRepository({ storage, delay: instant });
    expect((await restored.listRecords('outbound')).data.some(
      (row) => row.number === 'PKG-READY-001',
    )).toBe(true);
    expect((await restored.listRecords('reconciliations')).data.some(
      (row) => row.data.sourcePackage === 'PKG-READY-001',
    )).toBe(true);
    expect((await restored.listRecords('sync-jobs', { keyword: 'SYNC-FAIL-001' })).data[0].data)
      .toMatchObject({ attempts: 2, lastResult: 'success' });
    expect((await restored.listRecords('intent-orders', { keyword: 'IO-260822-0186' })).data[0].data)
      .toMatchObject({ workshop: '橡木车间', plannedDate: '2026-08-28' });
    expect((await restored.listRecords('intent-orders', { keyword: 'IO-RELOAD-001' })).data[0])
      .toMatchObject({ number: 'IO-RELOAD-001', amount: 88_000 });
    expect((await restored.getWorkbench('allocation')).preview).toEqual([
      { id: 'A', weight: 2, amountCents: 6667 },
      { id: 'B', weight: 1, amountCents: 3334 },
    ]);
    expect((await restored.listRecords('users', { keyword: 'u-sales' })).data[0].data)
      .toMatchObject({ enabled: false, role: 'planner' });
    expect((await restored.listRecords('roles', { keyword: 'ROLE-PLANNER' })).data[0].data)
      .toMatchObject({ members: 5, responsibility: '重载验证职责' });
  });
});

describe('MockEnterpriseRepository runtime JSON safety and transactional persistence', () => {
  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s create-intent amount without changing memory or storage', async (_name, amount) => {
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const before = await repository.listRecords('intent-orders');

    const result = await repository.perform({
      module: 'intent-orders',
      action: 'create-intent',
      ids: [],
      actor,
      payload: {
        number: 'IO-RUNTIME-INVALID',
        title: '非法金额订购意向',
        customer: '测试客户',
        amount,
      },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [] });
    expect(await repository.listRecords('intent-orders')).toEqual(before);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    const restored = createMockEnterpriseRepository({ storage, delay: instant });
    expect((await restored.listRecords('intent-orders')).data.some(
      (row) => row.number === 'IO-RUNTIME-INVALID',
    )).toBe(false);
  });

  it.each([
    ['numeric id', [{ id: 7, weight: 1 }]],
    ['blank id', [{ id: '   ', weight: 1 }]],
  ])('rejects an allocation weight item with %s', async (_name, weights) => {
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeAudit = await repository.listAuditEvents();

    const result = await repository.perform({
      module: 'allocation',
      action: 'allocate-cost',
      ids: ['CC-2026-08-01'],
      actor,
      payload: { totalCents: 10_001, weights },
    } as never);

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect((await repository.getWorkbench('allocation')).preview).toBeUndefined();
    expect(await repository.listAuditEvents()).toEqual(beforeAudit);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
  });

  const circularChanges: Record<string, unknown> = { deliveryDate: '2026-09-10' };
  circularChanges.self = circularChanges;
  const dangerousChanges = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;

  it.each([
    ['BigInt', { amount: 1n }],
    ['cycle', circularChanges],
    ['Infinity', { amount: Number.POSITIVE_INFINITY }],
    ['undefined', { deliveryDate: undefined }],
    ['symbol', { deliveryDate: Symbol('date') }],
    ['function', { calculate: () => 1 }],
    ['non-plain object', { deliveryDate: new Date('2026-09-10') }],
    ['dangerous prototype key', dangerousChanges],
  ])('resolves a failure for JSON-unsafe change-order %s without mutation', async (_name, changes) => {
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeRecord = (await repository.listRecords('order-changes')).data[0];

    await expect(repository.perform({
      module: 'order-changes',
      action: 'change-order',
      ids: ['OC-260822-0007'],
      actor,
      payload: { changes },
    })).resolves.toMatchObject({ success: false, affectedIds: [], events: [] });

    expect((await repository.listRecords('order-changes')).data[0]).toEqual(beforeRecord);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
  });

  it('validates JSON safety across the complete command including actor extensions', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const unsafeActor = { ...actor, metadata: 1n };

    await expect(repository.perform({
      module: 'todos', action: 'read', ids: [], actor: unsafeActor,
    })).resolves.toMatchObject({ success: false, affectedIds: [], events: [] });
  });

  it('keeps memory unchanged and resolves failure when storage commit throws', async () => {
    let persisted = JSON.stringify(createFixtureDatabase());
    const storage: MockStorage = {
      getItem: () => persisted,
      setItem: (_key, value) => {
        void value;
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        persisted = '';
      },
    };
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = persisted;
    const beforeIntent = (await repository.listRecords('intent-orders', {
      keyword: 'IO-260822-0186',
    })).data[0];

    await expect(repository.perform({
      module: 'intent-orders', action: 'audit', ids: ['IO-260822-0186'], actor,
    })).resolves.toMatchObject({ success: false, affectedIds: [], events: [] });

    expect((await repository.listRecords('intent-orders', {
      keyword: 'IO-260822-0186',
    })).data[0]).toEqual(beforeIntent);
    expect(persisted).toBe(beforeStorage);
  });

  it('uses the same storage-first commit for a traceable business failure', async () => {
    const persisted = JSON.stringify(createFixtureDatabase());
    const storage: MockStorage = {
      getItem: () => persisted,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeBatch = ((await repository.getWorkbench('batches')).records as BusinessRecord[])
      .find((row) => row.number === 'B260827-C') as BusinessRecord;
    const beforeAudit = await repository.listAuditEvents();

    await expect(repository.perform({
      module: 'batches',
      action: 'release-batch',
      ids: ['B260827-C'],
      actor,
      payload: { capacityUsage: 1.12, workshop: '胡桃木车间' },
    })).resolves.toMatchObject({ success: false, affectedIds: [], events: [] });

    expect(((await repository.getWorkbench('batches')).records as BusinessRecord[])
      .find((row) => row.number === 'B260827-C')).toEqual(beforeBatch);
    expect(await repository.listAuditEvents()).toEqual(beforeAudit);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(persisted);
  });
});

describe('MockEnterpriseRepository descriptor snapshot safety', () => {
  it('snapshots Proxy changes from data descriptors without invoking get(toJSON)', async () => {
    let toJsonReads = 0;
    const changes = new Proxy(
      { reason: '客户调整', deliveryDate: '2026-09-10' },
      {
        get: (target, property, receiver) => {
          if (property === 'toJSON') {
            toJsonReads += 1;
            return () => ({ deliveryDate: '2099-01-01', injected: true });
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    const result = await repository.perform({
      module: 'order-changes',
      action: 'change-order',
      ids: ['OC-260822-0007'],
      actor,
      payload: { changes },
    });

    expect(result.success).toBe(true);
    expect(toJsonReads).toBe(0);
    expect((await repository.listRecords('order-changes')).data[0].data.changes)
      .toEqual({ reason: '客户调整', deliveryDate: '2026-09-10' });
  });

  it('authorizes from the actor data descriptors instead of a Proxy get escalation', async () => {
    let roleReads = 0;
    const proxiedActor = new Proxy(
      { userId: 'u-planner', name: '计划员', role: 'planner' as const },
      {
        get: (target, property, receiver) => {
          if (property === 'role') {
            roleReads += 1;
            return 'admin';
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);

    const result = await repository.perform({
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor: proxiedActor,
      payload: {
        policy: {
          ...ROLE_POLICIES.planner,
          domains: [...ROLE_POLICIES.planner.domains, 'integration'],
        },
      },
    });

    expect(result.success).toBe(false);
    expect(roleReads).toBe(0);
    expect(await repository.getRolePolicy('planner')).toEqual(ROLE_POLICIES.planner);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
  });

  it('rejects an ids array with a custom prototype without invoking inherited toJSON', async () => {
    let toJsonCalls = 0;
    const ids = ['planner'];
    const customPrototype = Object.create(Array.prototype) as unknown[] & {
      toJSON: () => string[];
    };
    Object.defineProperty(customPrototype, 'toJSON', {
      value: () => {
        toJsonCalls += 1;
        return ['admin'];
      },
    });
    Object.setPrototypeOf(ids, customPrototype);
    const storage = createMemoryStorage();
    const repository = createMockEnterpriseRepository({ storage, delay: instant });
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);

    const result = await repository.perform({
      module: 'permissions',
      action: 'permission-change',
      ids,
      actor,
      payload: { policy: ROLE_POLICIES.admin },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(toJsonCalls).toBe(0);
    expect(await repository.getRolePolicy('admin')).toEqual(ROLE_POLICIES.admin);
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
  });

  it('resolves failure when a Proxy descriptor trap throws', async () => {
    const changes = new Proxy(
      { deliveryDate: '2026-09-10' },
      {
        ownKeys: () => {
          throw new Error('hostile ownKeys trap');
        },
      },
    );
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    await expect(repository.perform({
      module: 'order-changes',
      action: 'change-order',
      ids: ['OC-260822-0007'],
      actor,
      payload: { changes },
    })).resolves.toMatchObject({ success: false, affectedIds: [], events: [] });
  });
});

describe('MockEnterpriseRepository Task 7 write-scope and categorized-audit contract', () => {
  const salesActor = { userId: 'u-sales', name: '销售经理', role: 'sales' } as const;
  const productionActor = { userId: 'u-production', name: '生产主管', role: 'production' } as const;
  const warehouseActor = { userId: 'u-wh', name: '仓库主管', role: 'warehouse' } as const;

  function repositoryFromDatabase(database: ReturnType<typeof createFixtureDatabase>) {
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    return {
      repository: createMockEnterpriseRepository({
        storage,
        delay: instant,
        now: () => '2026-08-23T09:00:00.000Z',
      }),
      storage,
    };
  }

  async function expectDeniedWithoutMutation(
    database: ReturnType<typeof createFixtureDatabase>,
    command: PerformCommand,
  ) {
    const { repository, storage } = repositoryFromDatabase(database);
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeAudits = await repository.listAuditEvents();

    const result = await repository.perform(command);

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    expect(await repository.listAuditEvents()).toEqual(beforeAudits);
  }

  it('denies a non-group write when access context is missing', async () => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'intent-orders',
      action: 'submit',
      ids: ['IO-260822-0184'],
      actor: salesActor,
    });
  });

  it.each([
    ['role', { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' }],
    ['actor', { role: 'sales', actorId: 'u-admin', organizationId: 'ORG-01' }],
  ] as const)('denies a write when access %s does not match the actor', async (_field, access) => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'intent-orders',
      action: 'submit',
      ids: ['IO-260822-0184'],
      actor: salesActor,
      access,
    });
  });

  it('atomically denies organization scope when any existing target is outside scope', async () => {
    const database = createFixtureDatabase();
    const outside = database.records['intent-orders'].find((row) => row.number === 'IO-260822-0185');
    if (!outside) throw new Error('fixture missing IO-260822-0185');
    outside.status = 'draft';
    outside.organizationId = 'ORG-02';

    await expectDeniedWithoutMutation(database, {
      module: 'intent-orders',
      action: 'submit',
      ids: ['IO-260822-0184', 'IO-260822-0185'],
      actor: salesActor,
      access: {
        role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01',
      },
    });
  });

  it('denies factory-scoped workbench writes against their authoritative business record', async () => {
    const database = createFixtureDatabase();
    requiredRecord(
      database.records.users.find((user) => user.id === 'u-production'),
      'fixture missing u-production',
    ).factoryId = 'F-02';
    await expectDeniedWithoutMutation(database, {
      module: 'production-tasks',
      action: 'complete-task',
      ids: ['PT-260822-0066'],
      actor: productionActor,
      access: {
        role: 'production', actorId: 'u-production', organizationId: 'ORG-01',
        factoryId: 'F-02',
      },
    });
  });

  it('denies warehouse-scoped stock writes against their authoritative transfer record', async () => {
    const database = createFixtureDatabase();
    requiredRecord(
      database.records.users.find((user) => user.id === 'u-wh'),
      'fixture missing u-wh',
    ).warehouseId = 'WH-01';
    await expectDeniedWithoutMutation(database, {
      module: 'stock',
      action: 'transfer',
      ids: ['TR-260822-0003'],
      actor: warehouseActor,
      payload: { targetWarehouseId: 'WH-01' },
      access: {
        role: 'warehouse', actorId: 'u-wh', organizationId: 'ORG-01',
        factoryId: 'F-01', warehouseId: 'WH-01',
      },
    });
  });

  it('uses the persisted policy override to deny self-scoped writes to another owner', async () => {
    const database = createFixtureDatabase();
    database.roleOverrides.sales = { ...ROLE_POLICIES.sales, scope: 'self' };
    const target = database.records['intent-orders'].find((row) => row.number === 'IO-260822-0184');
    if (!target) throw new Error('fixture missing IO-260822-0184');
    target.ownerId = 'u-other';

    await expectDeniedWithoutMutation(database, {
      module: 'intent-orders',
      action: 'submit',
      ids: ['IO-260822-0184'],
      actor: salesActor,
      access: {
        role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01',
      },
    });
  });

  it.each([
    ['organization', { ...ROLE_POLICIES.sales, scope: 'organization' as const }, {
      number: 'IO-CROSS-ORG', title: '跨组织意向', customer: '测试客户', organizationId: 'ORG-02',
    }],
    ['owner', { ...ROLE_POLICIES.sales, scope: 'self' as const }, {
      number: 'IO-CROSS-OWNER', title: '跨业务员意向', customer: '测试客户', organizationId: 'ORG-01', ownerId: 'u-other',
    }],
  ] as const)('denies create-intent outside the persisted %s scope', async (_scope, policy, payload) => {
    const database = createFixtureDatabase();
    database.roleOverrides.sales = policy;
    await expectDeniedWithoutMutation(database, {
      module: 'intent-orders',
      action: 'create-intent',
      ids: [],
      actor: salesActor,
      access: {
        role: 'sales', actorId: 'u-sales', organizationId: 'ORG-01',
      },
      payload,
    });
  });

  it('keeps legacy no-access commands compatible for an admin group policy', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    const result = await repository.perform({
      module: 'intent-orders', action: 'submit', ids: ['IO-260822-0184'], actor,
    });
    expect(result.success).toBe(true);
  });

  it('authorizes and separates integration and security audit categories by their real domains', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });
    await repository.perform({
      module: 'permissions', action: 'permission-change', ids: ['planner'], actor,
      payload: { policy: ROLE_POLICIES.planner },
    });
    const integrationAccess = {
      role: 'warehouse' as const,
      actorId: 'u-wh',
      organizationId: 'ORG-01',
      factoryId: 'F-01',
      warehouseId: 'WH-02',
    };
    const adminAccess = {
      role: 'admin' as const, actorId: 'u-admin', organizationId: 'ORG-01',
    };

    const integration = await repository.listRecords('audits', {
      auditCategory: 'integration', access: integrationAccess,
    });
    const deniedSecurity = await repository.listRecords('audits', {
      auditCategory: 'security', access: integrationAccess,
    });
    const adminIntegration = await repository.listRecords('audits', {
      auditCategory: 'integration', access: adminAccess,
    });
    const adminSecurity = await repository.listRecords('audits', {
      auditCategory: 'security', access: adminAccess,
    });

    expect(integration.data.length).toBeGreaterThan(0);
    expect(integration.data.every((row) => row.domain === 'integration')).toBe(true);
    expect(integration.data.every((row) => ['retry-sync', 'push-order'].includes(String(row.data.action)))).toBe(true);
    expect(deniedSecurity.data).toEqual([]);
    expect(adminIntegration.data.every((row) => row.data.action !== 'permission-change')).toBe(true);
    expect(adminSecurity.data.some((row) => row.data.action === 'permission-change')).toBe(true);
    expect(adminSecurity.data.every((row) => row.domain === 'security')).toBe(true);
    expect(adminSecurity.data.every((row) => !['retry-sync', 'push-order'].includes(String(row.data.action)))).toBe(true);
  });
});

describe('MockEnterpriseRepository Task 7 Fix Round 2 trusted-principal contract', () => {
  const salesActor = { userId: 'u-sales', name: '任意客户端名称', role: 'sales' } as const;
  const productionActor = { userId: 'u-production', name: '生产主管', role: 'production' } as const;
  const warehouseActor = { userId: 'u-wh', name: '仓库主管', role: 'warehouse' } as const;
  const salesAccess = {
    role: 'sales' as const,
    actorId: 'u-sales',
    organizationId: 'ORG-01',
  };
  const productionAccess = {
    role: 'production' as const,
    actorId: 'u-production',
    organizationId: 'ORG-01',
    factoryId: 'F-01',
  };
  const warehouseAccess = {
    role: 'warehouse' as const,
    actorId: 'u-wh',
    organizationId: 'ORG-01',
    factoryId: 'F-01',
    warehouseId: 'WH-02',
  };
  const adminAccess = {
    role: 'admin' as const,
    actorId: 'u-admin',
    organizationId: 'ORG-01',
  };

  function repositoryFromDatabase(database: ReturnType<typeof createFixtureDatabase>) {
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    return {
      repository: createMockEnterpriseRepository({
        storage,
        delay: instant,
        now: () => '2026-08-23T10:00:00.000Z',
      }),
      storage,
    };
  }

  async function expectDeniedWithoutMutation(
    database: ReturnType<typeof createFixtureDatabase>,
    command: PerformCommand,
  ) {
    const { repository, storage } = repositoryFromDatabase(database);
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeAudits = await repository.listAuditEvents();

    const result = await repository.perform(command);

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    expect(await repository.listAuditEvents()).toEqual(beforeAudits);
  }

  it('publishes authoritative user scope at the top level of every directory record', () => {
    const users = createFixtureDatabase().records.users;
    expect(users.every((user) => user.organizationId === 'ORG-01' && user.ownerId === user.id)).toBe(true);
    expect(users.find((user) => user.id === 'u-production')).toMatchObject({ factoryId: 'F-01' });
    expect(users.find((user) => user.id === 'u-wh')).toMatchObject({
      factoryId: 'F-01',
      warehouseId: 'WH-02',
    });
    expect(users.find((user) => user.id === 'u-sales')).not.toHaveProperty('factoryId');
    expect(users.find((user) => user.id === 'u-sales')).not.toHaveProperty('warehouseId');
  });

  it.each([
    ['organization', salesActor, { ...salesAccess, organizationId: 'ORG-02' }],
    ['warehouse', warehouseActor, { ...warehouseAccess, warehouseId: 'WH-99' }],
  ] as const)('rejects a client-forged trusted %s without storage or audit mutation', async (
    _field,
    forgedActor,
    forgedAccess,
  ) => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: forgedActor.role === 'warehouse' ? 'stock' : 'intent-orders',
      action: forgedActor.role === 'warehouse' ? 'transfer' : 'submit',
      ids: [forgedActor.role === 'warehouse' ? 'TR-260822-0003' : 'IO-260822-0184'],
      actor: forgedActor,
      access: forgedAccess,
      ...(forgedActor.role === 'warehouse' ? { payload: { targetWarehouseId: 'WH-01' } } : {}),
    } as PerformCommand);
  });

  it('rejects u-sales role escalation even when the forged role has group scope', async () => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'permissions',
      action: 'permission-change',
      ids: ['planner'],
      actor: { userId: 'u-sales', name: '伪管理员', role: 'admin' },
      access: { role: 'admin', actorId: 'u-sales', organizationId: 'ORG-01' },
      payload: { policy: ROLE_POLICIES.admin },
    });
  });

  it('uses the trusted directory role and exact scope for list and workbench reads', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    expect((await repository.listRecords('intent-orders', {
      access: { ...salesAccess, organizationId: 'ORG-02' },
    })).data).toEqual([]);
    expect((await repository.listRecords('intent-orders', {
      access: { ...salesAccess, role: 'admin' } as never,
    })).data).toEqual([]);
    expect((await repository.getWorkbench('stock', {
      ...warehouseAccess,
      warehouseId: 'WH-99',
    })).records).toEqual([]);
    expect((await repository.listRecords('intent-orders', { access: salesAccess })).data.length).toBeGreaterThan(0);
  });

  it('rejects disabled directory principals before authorization', async () => {
    const database = createFixtureDatabase();
    const sales = database.records.users.find((user) => user.id === 'u-sales');
    if (!sales) throw new Error('fixture missing u-sales');
    sales.data.enabled = false;
    await expectDeniedWithoutMutation(database, {
      module: 'intent-orders', action: 'submit', ids: ['IO-260822-0184'],
      actor: salesActor, access: salesAccess,
    });
  });

  it('rejects a valid reporting barcode outside the trusted principal factory', async () => {
    const database = createFixtureDatabase();
    requiredRecord(
      database.records.users.find((user) => user.id === 'u-production'),
      'fixture missing u-production',
    ).factoryId = 'F-02';
    await expectDeniedWithoutMutation(database, {
      module: 'reporting', action: 'scan-report', ids: ['PT-BC-VALID'],
      actor: productionActor,
      access: { ...productionAccess, factoryId: 'F-02' },
      payload: { barcode: 'PT-BC-VALID', factoryId: 'F-02' },
    });
  });

  it('rejects a valid stock barcode outside the trusted principal warehouse', async () => {
    const database = createFixtureDatabase();
    requiredRecord(
      database.records.users.find((user) => user.id === 'u-wh'),
      'fixture missing u-wh',
    ).warehouseId = 'WH-99';
    await expectDeniedWithoutMutation(database, {
      module: 'stock', action: 'stock-in', ids: ['PKG-INBOUND-001'],
      actor: warehouseActor,
      access: { ...warehouseAccess, warehouseId: 'WH-99' },
      payload: { barcode: 'PKG-INBOUND-001', warehouseId: 'WH-99' },
    });
  });

  it('fails closed for an unknown write target before a handler or audit mutation', async () => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'intent-orders', action: 'submit', ids: ['IO-UNKNOWN'],
      actor: salesActor, access: salesAccess,
    });
  });

  it('rejects forged creation scope without persisting a client-selected organization or owner', async () => {
    const database = createFixtureDatabase();
    const { repository, storage } = repositoryFromDatabase(database);
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const result = await repository.perform({
      module: 'intent-orders', action: 'create-intent', ids: [],
      actor: salesActor, access: salesAccess,
      payload: {
        number: 'IO-TRUSTED-001', title: '可信范围意向', customer: '可信客户', amount: 100,
        organizationId: 'ORG-02', ownerId: 'u-admin', factoryId: 'F-99', warehouseId: 'WH-99',
        creditSufficient: true,
      },
    });

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    expect((await repository.listRecords('intent-orders', {
      keyword: 'IO-TRUSTED-001', access: salesAccess,
    })).data).toEqual([]);
  });

  it('requires a valid category and trusted access for all audit record reads', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    expect((await repository.listRecords('audits', { auditCategory: 'integration' })).data).toEqual([]);
    expect((await repository.listRecords('audits', {
      auditCategory: 'unknown' as never,
      access: adminAccess,
    })).data).toEqual([]);
    expect((await repository.listRecords('audits', {
      auditCategory: 'integration',
      access: { ...adminAccess, actorId: 'u-sales' },
    })).data).toEqual([]);
  });

  it('projects authoritative audit source scope and applies normal data filtering', async () => {
    const database = createFixtureDatabase();
    requiredRecord(
      database.records['sync-jobs'].find((record) => record.number === 'SYNC-FAIL-001'),
      'fixture missing SYNC-FAIL-001',
    ).warehouseId = 'WH-99';
    database.records['intent-orders'].unshift({
      ...database.records['intent-orders'][0],
      id: 'SYNC-FAIL-001', number: 'SYNC-FAIL-001', warehouseId: 'WH-02',
      title: '跨模块碰撞不能成为同步审计来源',
    });
    const { repository } = repositoryFromDatabase(database);

    const hidden = await repository.listRecords('audits', {
      auditCategory: 'integration', access: warehouseAccess,
    });
    const admin = await repository.listRecords('audits', {
      auditCategory: 'integration', access: adminAccess,
    });

    expect(hidden.data).toEqual([]);
    expect(admin.data).toHaveLength(1);
    expect(admin.data[0]).toMatchObject({
      organizationId: 'ORG-01',
      warehouseId: 'WH-99',
      data: expect.objectContaining({ recordId: 'SYNC-FAIL-001' }),
    });
  });

  it('fails closed when the action-authoritative module contains an ambiguous source', async () => {
    const database = createFixtureDatabase();
    const sync = requiredRecord(
      database.records['sync-jobs'].find((record) => record.id === 'SYNC-FAIL-001'),
      'fixture missing SYNC-FAIL-001',
    );
    database.records['sync-jobs'].push({ ...structuredClone(sync), title: '重复同步来源' });
    const { repository } = repositoryFromDatabase(database);

    expect((await repository.listRecords('audits', {
      auditCategory: 'integration', access: adminAccess,
    })).data.some((record) => record.data.recordId === 'SYNC-FAIL-001')).toBe(false);
  });

  it('uses exact security sources despite colliding ids in unrelated modules', async () => {
    const database = createFixtureDatabase();
    database.records['intent-orders'].unshift({
      ...database.records['intent-orders'][0], id: 'u-wh', number: 'u-wh',
      factoryId: 'F-99', warehouseId: 'WH-99',
    });
    database.roleOverrides.warehouse = {
      ...ROLE_POLICIES.warehouse,
      domains: [...ROLE_POLICIES.warehouse.domains, 'security'],
    };
    database.auditEvents.push({
      id: 'SEC-COLLISION', recordId: 'mock-database', action: 'reset-demo',
      actor: { userId: 'u-wh', name: '仓库主管', role: 'warehouse' },
      occurredAt: '2026-08-23T00:00:00.000Z', result: 'success', message: '安全来源碰撞测试',
      sourceModule: 'users',
    });
    const { repository } = repositoryFromDatabase(database);

    expect((await repository.listAuditEvents()).some((event) => event.id === 'SEC-COLLISION')).toBe(true);

    expect((await repository.listRecords('audits', {
      auditCategory: 'security', auditOrder: 'latest', access: warehouseAccess, pageSize: 100,
    })).data.map((record) => record.id)).toContain('SEC-COLLISION');
    expect((await repository.listRecords('audits', {
      auditCategory: 'security', auditOrder: 'latest', access: adminAccess, pageSize: 100,
    })).data.map((record) => record.id)).toContain('SEC-COLLISION');
  });

  it.each([
    ['missing reporting barcodeScopes', (database: ReturnType<typeof createFixtureDatabase>) => {
      delete database.workbenches.reporting.barcodeScopes;
    }],
    ['incomplete stock barcodeScopes', (database: ReturnType<typeof createFixtureDatabase>) => {
      const scopes = database.workbenches.stock.barcodeScopes as Record<string, unknown>;
      delete scopes['PKG-INBOUND-001'];
    }],
  ] as const)('recovers fixtures when persisted barcode authority metadata is invalid: %s', async (_name, corrupt) => {
    const database = createFixtureDatabase();
    corrupt(database);
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    const repository = createMockEnterpriseRepository({ storage, delay: instant });

    const reporting = await repository.getWorkbench('reporting', productionAccess);
    const stock = await repository.getWorkbench('stock', warehouseAccess);
    expect(reporting.barcodeScopes).toBeDefined();
    expect(stock.barcodeScopes).toBeDefined();
  });
});

describe('MockEnterpriseRepository Task 7 Fix Round 3 delegated-administration contract', () => {
  const salesActor = { userId: 'u-sales', name: '销售经理', role: 'sales' } as const;
  const salesAccess = {
    role: 'sales' as const,
    actorId: 'u-sales',
    organizationId: 'ORG-01',
  };
  const adminAccess = {
    role: 'admin' as const,
    actorId: 'u-admin',
    organizationId: 'ORG-01',
  };

  function repositoryFromDatabase(database: ReturnType<typeof createFixtureDatabase>) {
    const storage = createMemoryStorage({ [MOCK_STORAGE_KEY]: JSON.stringify(database) });
    return {
      repository: createMockEnterpriseRepository({
        storage,
        delay: instant,
        now: () => '2026-08-23T11:00:00.000Z',
      }),
      storage,
    };
  }

  function grantSalesUserAdministration(
    database: ReturnType<typeof createFixtureDatabase>,
    scope: 'organization' | 'factory' | 'warehouse' = 'organization',
  ) {
    database.roleOverrides.sales = {
      ...ROLE_POLICIES.sales,
      domains: [...ROLE_POLICIES.sales.domains, 'security', 'planning'],
      actions: [...ROLE_POLICIES.sales.actions, 'user-admin'],
      scope,
    };
  }

  async function expectDeniedWithoutMutation(
    database: ReturnType<typeof createFixtureDatabase>,
    command: PerformCommand,
  ) {
    const { repository, storage } = repositoryFromDatabase(database);
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeAudits = await repository.listAuditEvents();

    const result = await repository.perform(command);

    expect(result).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    expect(await repository.listAuditEvents()).toEqual(beforeAudits);
  }

  it.each([
    ['factory', 'schedule'],
    ['warehouse', 'schedule'],
  ] as const)('fails closed across list, workbench and perform when a %s override lacks its dimension', async (
    scope,
    workbench,
  ) => {
    const database = createFixtureDatabase();
    grantSalesUserAdministration(database, scope);
    const { repository, storage } = repositoryFromDatabase(database);
    const beforeStorage = storage.getItem(MOCK_STORAGE_KEY);
    const beforeAudits = await repository.listAuditEvents();

    expect((await repository.listRecords('intent-orders', { access: salesAccess })).data).toEqual([]);
    expect((await repository.getWorkbench(workbench, salesAccess)).records).toEqual([]);
    expect(await repository.perform({
      module: 'intent-orders', action: 'submit', ids: ['IO-260822-0184'],
      actor: salesActor, access: salesAccess,
    })).toMatchObject({ success: false, affectedIds: [], events: [] });
    expect(storage.getItem(MOCK_STORAGE_KEY)).toBe(beforeStorage);
    expect(await repository.listAuditEvents()).toEqual(beforeAudits);
  });

  it.each([
    ['promote itself', 'u-sales', { role: 'admin' }],
    ['disable itself', 'u-sales', { enabled: false }],
    ['change another user role', 'u-planner', { role: 'finance' }],
    ['disable an administrator', 'u-admin', { enabled: false }],
  ] as const)('prevents delegated sales user administration from attempting to %s', async (
    _case,
    target,
    payload,
  ) => {
    const database = createFixtureDatabase();
    grantSalesUserAdministration(database);
    await expectDeniedWithoutMutation(database, {
      module: 'users', action: 'user-admin', ids: [target],
      actor: salesActor, access: salesAccess, payload,
    });
  });

  it('does not allow a failed delegated self-promotion to continue into permission administration', async () => {
    const database = createFixtureDatabase();
    grantSalesUserAdministration(database);
    const { repository } = repositoryFromDatabase(database);

    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-sales'],
      actor: salesActor, access: salesAccess, payload: { role: 'admin' },
    })).success).toBe(false);
    expect((await repository.perform({
      module: 'permissions', action: 'permission-change', ids: ['planner'],
      actor: salesActor, access: salesAccess, payload: { policy: ROLE_POLICIES.admin },
    })).success).toBe(false);
    expect(await repository.getRolePolicy('planner')).toEqual(ROLE_POLICIES.planner);
  });

  it('allows a scoped non-admin delegate to change only another non-admin enabled state', async () => {
    const database = createFixtureDatabase();
    grantSalesUserAdministration(database);
    const { repository } = repositoryFromDatabase(database);

    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-planner'],
      actor: salesActor, access: salesAccess, payload: { enabled: false },
    })).success).toBe(true);
    expect((await repository.listRecords('users', {
      keyword: 'u-planner', access: salesAccess,
    })).data[0].data.enabled).toBe(false);
  });

  it.each([
    ['disable', { enabled: false }],
    ['demote', { role: 'sales' }],
  ] as const)('protects the last enabled administrator from %s', async (_case, payload) => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'users', action: 'user-admin', ids: ['u-admin'],
      actor, payload,
    });
  });

  it('allows the original administrator to be demoted after a second administrator is enabled', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-sales'],
      actor, payload: { role: 'admin' },
    })).success).toBe(true);
    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-admin'],
      actor, payload: { role: 'sales' },
    })).success).toBe(true);

    const users = await repository.listRecords('users');
    expect(users.data.find((user) => user.id === 'u-sales')?.data.role).toBe('admin');
    expect(users.data.find((user) => user.id === 'u-admin')?.data.role).toBe('sales');
  });

  it('resolves the current enabled role principal across administrator handoff and reset', async () => {
    const repository = createMockEnterpriseRepository({ storage: createMemoryStorage(), delay: instant });

    await expect(repository.getRolePrincipal('admin')).resolves.toMatchObject({
      actor: { userId: 'u-admin', role: 'admin' },
      access: { actorId: 'u-admin', role: 'admin', organizationId: 'ORG-01' },
    });
    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-sales'],
      actor, payload: { role: 'admin' },
    })).success).toBe(true);
    expect((await repository.perform({
      module: 'users', action: 'user-admin', ids: ['u-admin'],
      actor, payload: { enabled: false },
    })).success).toBe(true);

    await expect(repository.getRolePrincipal('admin')).resolves.toMatchObject({
      actor: { userId: 'u-sales', role: 'admin' },
      access: { actorId: 'u-sales', role: 'admin', organizationId: 'ORG-01' },
    });
    await expect(repository.getRolePrincipal('sales')).resolves.toBeUndefined();

    const reset = await repository.reset({ userId: 'u-sales', name: '销售员', role: 'admin' });
    expect(reset.success).toBe(true);
    await expect(repository.getRolePrincipal('admin')).resolves.toMatchObject({
      actor: { userId: 'u-admin', role: 'admin' },
    });
  });

  it('skips an earlier enabled same-role user whose effective scope is invalid', async () => {
    const database = createFixtureDatabase();
    const sales = requiredRecord(
      database.records.users.find((user) => user.id === 'u-sales'),
      'fixture missing u-sales',
    );
    sales.data.role = 'warehouse';
    const { repository } = repositoryFromDatabase(database);

    await expect(repository.getRolePrincipal('warehouse')).resolves.toMatchObject({
      actor: { userId: 'u-wh', role: 'warehouse' },
      access: {
        actorId: 'u-wh',
        role: 'warehouse',
        organizationId: 'ORG-01',
        factoryId: 'F-01',
        warehouseId: 'WH-02',
      },
    });
  });

  it('rejects assigning warehouse role to a user without authoritative warehouse scope', async () => {
    await expectDeniedWithoutMutation(createFixtureDatabase(), {
      module: 'users', action: 'user-admin', ids: ['u-sales'],
      actor, payload: { role: 'warehouse' },
    });
  });

  it('does not match a permission audit to the actor user through a shared role key', async () => {
    const database = createFixtureDatabase();
    const collision = requiredRecord(
      database.records['intent-orders'][0],
      'fixture missing intent order',
    );
    database.records['intent-orders'].push({
      ...structuredClone(collision),
      id: 'INTENT-ROLE-NUMBER-COLLISION',
      number: 'planner',
      ownerId: 'u-planner',
      organizationId: 'ORG-01',
    });
    requiredRecord(
      database.records.roles.find((record) => record.data.role === 'planner'),
      'fixture missing planner role',
    ).organizationId = 'ORG-02';
    const { repository } = repositoryFromDatabase(database);
    const delegatedPlannerPolicy = {
      ...ROLE_POLICIES.planner,
      domains: [...ROLE_POLICIES.planner.domains, 'security'],
      scope: 'self' as const,
    };
    expect((await repository.perform({
      module: 'permissions', action: 'permission-change', ids: ['planner'],
      actor, payload: { policy: delegatedPlannerPolicy },
    })).success).toBe(true);

    const plannerAudits = await repository.listRecords('audits', {
      auditCategory: 'security',
      access: { role: 'planner', actorId: 'u-planner', organizationId: 'ORG-01' },
    });
    const adminAudits = await repository.listRecords('audits', {
      auditCategory: 'security', access: adminAccess,
    });

    expect(plannerAudits.data).toEqual([]);
    expect(adminAudits.data).toHaveLength(1);
    expect(adminAudits.data[0]).toMatchObject({
      organizationId: 'ORG-02',
      data: expect.objectContaining({ action: 'permission-change', recordId: 'planner' }),
    });
    expect(adminAudits.data[0]).not.toHaveProperty('ownerId');
  });
});
