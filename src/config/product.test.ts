import { describe, expect, it } from 'vitest';
import { MOCK_STORAGE_KEY, PRODUCT_NAME, PRODUCT_SHORT_NAME } from './product';

describe('product identity', () => {
  it('keeps the technical package name out of the visible product brand', () => {
    expect(PRODUCT_NAME).toBe('现代离散制造 ERP 系统');
    expect(PRODUCT_SHORT_NAME).toBe('现代离散制造 ERP');
    expect(PRODUCT_NAME).not.toContain('hch-erp');
    expect(MOCK_STORAGE_KEY).toBe('hch-erp:mock-db:v1');
  });
});
