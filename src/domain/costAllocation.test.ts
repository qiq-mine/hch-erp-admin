import { describe, expect, it } from 'vitest';
import { allocateByPhysicalWeight } from './costAllocation';

describe('allocateByPhysicalWeight', () => {
  it('preserves the total and assigns rounding remainder deterministically', () => {
    const result = allocateByPhysicalWeight(10001, [
      { id: 'a', weight: 2 },
      { id: 'b', weight: 1 },
    ]);

    expect(result).toEqual([
      { id: 'a', weight: 2, amountCents: 6667 },
      { id: 'b', weight: 1, amountCents: 3334 },
    ]);
    expect(result.reduce((sum, item) => sum + item.amountCents, 0)).toBe(10001);
  });

  it('rejects a zero total weight', () => {
    expect(() => allocateByPhysicalWeight(100, [{ id: 'a', weight: 0 }])).toThrow(
      '分摊总权重必须大于 0',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 100.5, -1])(
    'rejects an invalid total cents value: %s',
    (totalCents) => {
      expect(() => allocateByPhysicalWeight(totalCents, [{ id: 'a', weight: 1 }])).toThrow(
        '总金额必须是非负整数',
      );
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'rejects an invalid item weight: %s',
    (weight) => {
      expect(() => allocateByPhysicalWeight(100, [{ id: 'a', weight }])).toThrow(
        '物理权重必须是有限且非负数',
      );
    },
  );

  it('allows an individual zero weight when another item has positive weight', () => {
    expect(
      allocateByPhysicalWeight(100, [
        { id: 'zero', weight: 0 },
        { id: 'positive', weight: 1 },
      ]),
    ).toEqual([
      { id: 'zero', weight: 0, amountCents: 0 },
      { id: 'positive', weight: 1, amountCents: 100 },
    ]);
  });

  it('rejects a non-finite total weight', () => {
    expect(() =>
      allocateByPhysicalWeight(100, [
        { id: 'a', weight: Number.MAX_VALUE },
        { id: 'b', weight: Number.MAX_VALUE },
      ]),
    ).toThrow('分摊总权重必须大于 0');
  });

  it('assigns tied largest remainders by original input order without mutating items', () => {
    const items = [
      { id: 'first', weight: 1 },
      { id: 'second', weight: 1 },
      { id: 'third', weight: 1 },
    ];
    const original = structuredClone(items);

    expect(allocateByPhysicalWeight(1, items)).toEqual([
      { id: 'first', weight: 1, amountCents: 1 },
      { id: 'second', weight: 1, amountCents: 0 },
      { id: 'third', weight: 1, amountCents: 0 },
    ]);
    expect(items).toEqual(original);
  });
});
