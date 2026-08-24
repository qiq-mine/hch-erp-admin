import { ROLE_POLICIES } from '@/config/roles';
import type { AuditEvent, BusinessRecord, DomainKey, RoleKey } from '@/domain/types';
import type { MockDatabase } from './types';

const FIXTURE_TIME = '2026-08-22T08:00:00.000Z';

function makeRecord(
  number: string,
  title: string,
  domain: DomainKey,
  status: BusinessRecord['status'],
  options: Partial<Omit<BusinessRecord, 'id' | 'number' | 'title' | 'domain' | 'status'>> = {},
): BusinessRecord {
  return {
    id: number,
    number,
    title,
    domain,
    status,
    organizationId: 'ORG-01',
    updatedAt: FIXTURE_TIME,
    audit: [],
    data: {},
    ...options,
  };
}

const clone = <T>(value: T): T => structuredClone(value);

export function createFixtureDatabase(): MockDatabase {
  const intentOrders = [
    makeRecord('IO-260822-0184', '华北门店橱柜订购意向', 'sales', 'draft', {
      ownerId: 'u-sales',
      amount: 186_000,
      data: { customer: '华北家居', creditSufficient: true, deliveryDate: '2026-08-30' },
    }),
    makeRecord('IO-260822-0185', '华南展厅衣柜订购意向', 'sales', 'submitted', {
      ownerId: 'u-sales',
      amount: 328_000,
      data: { customer: '华南展厅', creditSufficient: false, deliveryDate: '2026-09-02' },
    }),
    makeRecord('IO-260822-0186', '华东家居橱柜订购意向', 'sales', 'submitted', {
      ownerId: 'u-sales',
      amount: 268_000,
      data: { customer: '华东家居', creditSufficient: true, deliveryDate: '2026-08-29' },
    }),
  ];

  const salesOrders = [
    makeRecord('SO-260821-0098', '华东家居销售订单', 'sales', 'audited', {
      ownerId: 'u-sales',
      amount: 236_000,
      data: { customer: '华东家居', sourceNumber: 'IO-260821-0170' },
    }),
  ];

  const batches = [
    makeRecord('B260826-A', '橡木 18mm 合批', 'planning', 'audited', {
      factoryId: 'F-01',
      data: { workshop: '橡木车间', capacityUsage: 0.76, orderCount: 3 },
    }),
    makeRecord('B260827-C', '胡桃木 16mm 合批', 'planning', 'audited', {
      factoryId: 'F-01',
      data: { workshop: '胡桃木车间', capacityUsage: 1.12, orderCount: 5 },
    }),
  ];

  const productionTasks = [
    makeRecord('PT-260822-0066', '柜体开料与封边任务', 'manufacturing', 'executing', {
      factoryId: 'F-01',
      ownerId: 'u-production',
      data: { packageNumber: 'PKG-READY-001', progress: 0.92 },
    }),
  ];

  const packagingRecords = [
    makeRecord('PKG-READY-001', '华东家居橱柜包件', 'manufacturing', 'audited', {
      factoryId: 'F-01',
      warehouseId: 'WH-02',
      data: {
        kittingRate: 0.75,
        missingParts: ['门板 × 1'],
        requiredQuantity: 4,
        scannedQuantity: 3,
      },
    }),
    makeRecord('PKG-NOT-KITTED', '未齐套衣柜包件', 'manufacturing', 'audited', {
      factoryId: 'F-01',
      warehouseId: 'WH-02',
      data: { kittingRate: 0.75, missingParts: ['门板 × 1'] },
    }),
  ];

  const syncFailedEvent: AuditEvent = {
    id: 'SYNC-FAIL-001-1',
    recordId: 'SYNC-FAIL-001',
    action: 'retry-sync',
    actor: { userId: 'system', name: '集成服务', role: 'admin' },
    occurredAt: FIXTURE_TIME,
    result: 'failed',
    message: 'WMS-TIMEOUT：目标系统响应超时',
    sourceModule: 'sync-jobs',
  };

  const syncJobs = [
    makeRecord('SYNC-OK-001', 'CRM 客户同步', 'integration', 'completed', {
      factoryId: 'F-01',
      warehouseId: 'WH-02',
      data: {
        system: 'CRM',
        direction: 'CRM → ERP',
        batch: 'CRM-260822-01',
        attempts: 1,
      },
    }),
    makeRecord('SYNC-FAIL-001', 'WMS 出库同步', 'integration', 'sync-failed', {
      audit: [syncFailedEvent],
      factoryId: 'F-01',
      warehouseId: 'WH-02',
      data: {
        system: 'WMS',
        direction: 'ERP → WMS',
        batch: 'WMS-260822-03',
        sourceObject: '出库单',
        targetObject: '出库任务',
        errorCode: 'WMS-TIMEOUT',
        errorSummary: '目标系统响应超时',
        attempts: 1,
      },
    }),
  ];

  const roleKeys = Object.keys(ROLE_POLICIES) as RoleKey[];
  const roleRecords = roleKeys.map((role) =>
    makeRecord(`ROLE-${role.toUpperCase()}`, ROLE_POLICIES[role].label, 'security', 'audited', {
      data: { role, members: role === 'admin' ? 2 : 4, responsibility: `${ROLE_POLICIES[role].label}职责` },
    }),
  );
  const userRecords = [
    ['u-admin', '系统管理员', 'admin'],
    ['u-sales', '销售经理', 'sales'],
    ['u-planner', '计划员', 'planner'],
    ['u-production', '生产主管', 'production'],
    ['u-wh', '仓库主管', 'warehouse'],
    ['u-finance', '财务主管', 'finance'],
    ['u-general', '总经理', 'general'],
  ].map(([id, name, role]) => {
    const scopedLocation = role === 'warehouse'
      ? { factoryId: 'F-01', warehouseId: 'WH-02' }
      : role === 'production'
        ? { factoryId: 'F-01' }
        : {};
    return makeRecord(String(id), String(name), 'security', 'audited', {
      ...scopedLocation,
      ownerId: String(id),
      data: { role, enabled: true },
    });
  });

  const inbound = [
    makeRecord('IN-260822-0101', '二号仓包件入库', 'warehouse', 'submitted', {
      factoryId: 'F-01',
      warehouseId: 'WH-02',
      data: { packageNumber: 'PKG-260822-0101' },
    }),
    makeRecord('IN-260822-0102', '一号仓五金入库', 'warehouse', 'submitted', {
      factoryId: 'F-01',
      warehouseId: 'WH-01',
      data: { packageNumber: 'PKG-260822-0102' },
    }),
  ];

  const costCollection = makeRecord(
    'CC-2026-08-01',
    '八月制造费用归集',
    'finance',
    'audited',
    {
      amount: 10_001,
      data: {
        totalCents: 10_001,
        weights: [
          { id: '橡木柜体', weight: 2 },
          { id: '胡桃木门板', weight: 1 },
          { id: '五金包', weight: 1 },
        ],
      },
    },
  );

  const reconciliation = makeRecord(
    'REC-260822-0031',
    '华东家居应收核销',
    'finance',
    'submitted',
    { amount: 236_000, data: { sourcePackage: 'PKG-260821-0098' } },
  );

  const reportingRecord = makeRecord(
    'PKG-260822-DUP',
    '已报工条码',
    'manufacturing',
    'completed',
    { factoryId: 'F-01', data: { barcode: 'PKG-260822-DUP' } },
  );

  const records: MockDatabase['records'] = {
    todos: [
      makeRecord('TODO-PLN-001', '待排程：华东家居订单', 'planning', 'submitted', {
        ownerId: 'u-planner',
        data: { sourceNumber: 'SO-260821-0098' },
      }),
    ],
    alerts: [
      makeRecord('ALT-CAP-001', '胡桃木车间产能超载', 'planning', 'validation-failed', {
        factoryId: 'F-01',
        data: { sourceNumber: 'B260827-C', capacityUsage: 1.12 },
      }),
    ],
    'intent-orders': intentOrders,
    'sales-orders': salesOrders,
    'order-changes': [
      makeRecord('OC-260822-0007', '销售订单交期变更', 'sales', 'submitted', {
        data: { sourceNumber: 'SO-260821-0098' },
      }),
    ],
    'credit-approvals': [
      makeRecord('CA-260822-0012', '华南展厅信用特批', 'sales', 'submitted', {
        data: { sourceNumber: 'IO-260822-0185' },
      }),
    ],
    'production-tasks': productionTasks,
    inbound,
    outbound: [],
    transfers: [
      makeRecord('TR-260822-0003', '二号仓至一号仓调拨', 'warehouse', 'draft', {
        warehouseId: 'WH-02',
        data: { targetWarehouseId: 'WH-01' },
      }),
    ],
    reconciliations: [reconciliation],
    'cost-collections': [costCollection],
    'sync-jobs': syncJobs,
    users: userRecords,
    roles: roleRecords,
    audits: [],
  };

  const workbenches: MockDatabase['workbenches'] = {
    schedule: { records: clone(intentOrders), workshop: '橡木车间', dailyCapacity: 1200 },
    batches: { records: clone(batches) },
    capacity: {
      records: clone(batches),
      days: [
        { date: '2026-08-26', workshop: '橡木车间', usage: 0.76 },
        { date: '2026-08-27', workshop: '胡桃木车间', usage: 1.12 },
      ],
    },
    reporting: {
      records: [reportingRecord],
      successfulScans: [clone(reportingRecord)],
      seenBarcodes: ['PKG-260822-DUP'],
      knownBarcodes: {
        'PKG-260822-DUP': { process: 'reporting', kitted: true, outbound: false },
        'PT-BC-VALID': { process: 'reporting', kitted: true, outbound: false },
        'PKG-WRONG-PROCESS': { process: 'packaging', kitted: true, outbound: false },
        'PKG-READY-001': { process: 'outbound', kitted: false, outbound: false },
        'PKG-NOT-KITTED': { process: 'outbound', kitted: false, outbound: false },
        'PKG-OUTBOUND': { process: 'outbound', kitted: true, outbound: true },
      },
      barcodeScopes: {
        'PKG-260822-DUP': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
        'PT-BC-VALID': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
        'PKG-WRONG-PROCESS': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
        'PKG-READY-001': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
        'PKG-NOT-KITTED': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
        'PKG-OUTBOUND': { organizationId: 'ORG-01', factoryId: 'F-01', ownerId: 'u-production' },
      },
    },
    packaging: { records: packagingRecords, seenBarcodes: [] },
    stock: {
      records: clone(inbound),
      knownBarcodes: {
        'PKG-READY-001': { process: 'outbound', kitted: false, outbound: false },
        'PKG-NOT-KITTED': { process: 'outbound', kitted: false, outbound: false },
        'PKG-OUTBOUND': { process: 'outbound', kitted: true, outbound: true },
        'PKG-INBOUND-001': { process: 'inbound', kitted: true, outbound: false },
      },
      barcodeScopes: {
        'PKG-READY-001': {
          organizationId: 'ORG-01', factoryId: 'F-01', warehouseId: 'WH-02', ownerId: 'u-wh',
        },
        'PKG-NOT-KITTED': {
          organizationId: 'ORG-01', factoryId: 'F-01', warehouseId: 'WH-02', ownerId: 'u-wh',
        },
        'PKG-OUTBOUND': {
          organizationId: 'ORG-01', factoryId: 'F-01', warehouseId: 'WH-02', ownerId: 'u-wh',
        },
        'PKG-INBOUND-001': {
          organizationId: 'ORG-01', factoryId: 'F-01', warehouseId: 'WH-02', ownerId: 'u-wh',
        },
      },
      seenBarcodes: [],
    },
    allocation: { records: [clone(costCollection)], weights: clone(costCollection.data.weights) },
    analysis: {
      records: [],
      customerProfit: [{ customer: '华东家居', revenue: 236000, profitRate: 0.23 }],
      expenseVariance: [{ item: '制造费用', budget: 82000, actual: 84600 }],
    },
    'integration-monitor': {
      records: clone(syncJobs),
      systems: [
        { name: 'CRM', healthy: true, throughput: 128, failures: 0 },
        { name: 'WMS', healthy: false, throughput: 84, failures: 1 },
      ],
    },
    'sync-mappings': {
      records: [],
      mappings: [
        { source: 'CRM.Order', target: 'ERP.IntentOrder', rule: 'customerCode → buyerCode', enabled: true },
      ],
    },
    permissions: { records: clone(roleRecords), policies: clone(ROLE_POLICIES) },
  };

  return {
    records,
    workbenches,
    roleOverrides: {},
    auditEvents: [clone(syncFailedEvent)],
  };
}
