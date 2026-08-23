import { describe, expect, it, vi } from 'vitest';
import roleModel, {
  createRoleModel,
  getBrowserRoleStorage,
  ROLE_STORAGE_KEY,
} from './role';

function createStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
}

describe('createRoleModel', () => {
  it('defaults to admin, persists planner, and reports the switch', () => {
    const { storage, values } = createStorage();
    const onSwitch = vi.fn();
    const model = createRoleModel(storage, onSwitch);

    expect(model.getActiveRole()).toBe('admin');
    model.switchRole('planner');
    expect(values.get(ROLE_STORAGE_KEY)).toBe('planner');
    expect(onSwitch).toHaveBeenCalledWith('admin', 'planner');
  });

  it('restores only a valid persisted role and ignores no-op switches', () => {
    const restored = createRoleModel(createStorage({ [ROLE_STORAGE_KEY]: 'warehouse' }).storage);
    expect(restored.getActiveRole()).toBe('warehouse');

    const { storage, values } = createStorage({ [ROLE_STORAGE_KEY]: 'not-a-role' });
    const onSwitch = vi.fn();
    const invalid = createRoleModel(storage, onSwitch);
    expect(invalid.getActiveRole()).toBe('admin');
    invalid.switchRole('admin');
    expect(values.get(ROLE_STORAGE_KEY)).toBe('admin');
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('exposes unavailable storage and initializes the Umi model without an active role when the browser getter is blocked', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });

    try {
      const storage = getBrowserRoleStorage();
      expect(() => storage.getItem(ROLE_STORAGE_KEY)).toThrow();
      expect(() => storage.setItem(ROLE_STORAGE_KEY, 'planner')).toThrow();
      expect(roleModel().activeRole).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  });
});
