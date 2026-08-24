import { afterEach, describe, expect, it, vi } from 'vitest';

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor);
  else Reflect.deleteProperty(window, 'localStorage');
  vi.resetModules();
});

describe('enterprise repository bootstrap', () => {
  it('dynamically imports with an independent memory fixture when the localStorage getter throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    vi.resetModules();

    const { enterpriseRepository } = await import('./index');
    const todos = await enterpriseRepository.listRecords('todos');

    expect(todos.success).toBe(true);
    expect(todos.data.length).toBeGreaterThan(0);
  });
});
