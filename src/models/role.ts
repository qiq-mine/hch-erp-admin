import type { RoleKey } from '@/domain/types';

export interface RoleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const ROLE_STORAGE_KEY = 'hch-erp:active-role';
export const ROLE_COMMIT_KEY = 'hch-erp:active-role:commit';

const ROLE_KEYS: readonly RoleKey[] = [
  'general',
  'sales',
  'planner',
  'production',
  'warehouse',
  'finance',
  'admin',
];

const isRoleKey = (value: string | null): value is RoleKey =>
  value !== null && ROLE_KEYS.includes(value as RoleKey);

const marker = (status: 'pending' | 'committed', role: RoleKey, generation: number) =>
  JSON.stringify({ version: 1, status, role, generation });

function writeVerified(storage: RoleStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch (cause) {
    try {
      if (storage.getItem(key) === value) return;
    } catch {
      // The original write failure is authoritative when readback is unavailable.
    }
    throw cause;
  }
}

export function commitStoredRole(storage: RoleStorage, role: RoleKey, generation = Date.now()): void {
  writeVerified(storage, ROLE_COMMIT_KEY, marker('pending', role, generation));
  writeVerified(storage, ROLE_STORAGE_KEY, role);
  writeVerified(storage, ROLE_COMMIT_KEY, marker('committed', role, generation));
}

export function readCommittedRole(storage: RoleStorage): RoleKey {
  const persistedRole = storage.getItem(ROLE_STORAGE_KEY);
  const rawMarker = storage.getItem(ROLE_COMMIT_KEY);
  if (rawMarker === null) {
    const legacyRole = isRoleKey(persistedRole) ? persistedRole : 'admin';
    commitStoredRole(storage, legacyRole, 0);
    return legacyRole;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMarker);
  } catch {
    throw new Error('角色提交标记无效');
  }
  if (
    typeof parsed !== 'object' || parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    (parsed as { status?: unknown }).status !== 'committed' ||
    !isRoleKey((parsed as { role?: string }).role ?? null) ||
    (parsed as { role: RoleKey }).role !== persistedRole ||
    !Number.isSafeInteger((parsed as { generation?: unknown }).generation)
  ) throw new Error('角色提交未完成');
  return (parsed as { role: RoleKey }).role;
}

export function createRoleModel(
  storage: RoleStorage,
  onSwitch?: (from: RoleKey, to: RoleKey) => void,
) {
  let activeRole: RoleKey = readCommittedRole(storage);

  return {
    getActiveRole: () => activeRole,
    switchRole(role: RoleKey) {
      if (role === activeRole) return;
      const previous = activeRole;
      activeRole = role;
      commitStoredRole(storage, role);
      onSwitch?.(previous, role);
    },
  };
}

const emptyStorage: RoleStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const unavailableStorage: RoleStorage = Object.freeze({
  getItem: () => {
    throw new Error('浏览器角色存储不可用');
  },
  setItem: () => {
    throw new Error('浏览器角色存储不可用');
  },
  removeItem: () => {
    throw new Error('浏览器角色存储不可用');
  },
});

export function getBrowserRoleStorage(): RoleStorage {
  if (typeof window === 'undefined') return emptyStorage;
  try {
    return window.localStorage ?? unavailableStorage;
  } catch {
    return unavailableStorage;
  }
}

export default function roleModel() {
  try {
    const model = createRoleModel(getBrowserRoleStorage());
    return {
      activeRole: model.getActiveRole(),
      ...model,
    };
  } catch {
    return {
      activeRole: undefined,
      getActiveRole: () => undefined,
      switchRole: (_role: RoleKey) => {
        throw new Error('浏览器角色存储不可用');
      },
    };
  }
}
