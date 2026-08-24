import { createMemoryStorage, type MockStorage } from './memoryStorage';
import { createMockEnterpriseRepository } from './mockRepository';

const browserStorage = (): MockStorage => {
  if (typeof window === 'undefined') return createMemoryStorage();
  try {
    const storage = window.localStorage;
    return storage ?? createMemoryStorage();
  } catch {
    return createMemoryStorage();
  }
};

const productionDelay = () =>
  new Promise<void>((resolve) => {
    const milliseconds = 150 + Math.floor(Math.random() * 351);
    setTimeout(resolve, milliseconds);
  });

export const enterpriseRepository = createMockEnterpriseRepository({
  storage: browserStorage(),
  delay: productionDelay,
  now: () => new Date().toISOString(),
});

export { createFixtureDatabase } from './fixtures';
export { createMemoryStorage, type MockStorage } from './memoryStorage';
export { createMockEnterpriseRepository } from './mockRepository';
export type * from './types';
