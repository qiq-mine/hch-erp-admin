export interface WeightItem {
  id: string;
  weight: number;
}

export interface AllocationItem extends WeightItem {
  amountCents: number;
}

export function allocateByPhysicalWeight(
  totalCents: number,
  items: WeightItem[],
): AllocationItem[] {
  if (!Number.isFinite(totalCents) || !Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('总金额必须是非负整数');
  }

  for (const item of items) {
    if (!Number.isFinite(item.weight) || item.weight < 0) {
      throw new Error('物理权重必须是有限且非负数');
    }
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('分摊总权重必须大于 0');
  }

  const base = items.map((item, index) => {
    const exact = (totalCents * item.weight) / totalWeight;
    const amountCents = Math.floor(exact);
    return { ...item, amountCents, fractional: exact - amountCents, index };
  });
  const remainder = totalCents - base.reduce((sum, item) => sum + item.amountCents, 0);

  const remainderRecipients = [...base]
    .sort((left, right) => right.fractional - left.fractional || left.index - right.index)
    .slice(0, Math.max(0, remainder));
  const recipientIndexes = new Set(remainderRecipients.map((item) => item.index));

  return base.map(({ fractional: _fractional, index, ...item }) => ({
    ...item,
    amountCents: item.amountCents + (recipientIndexes.has(index) ? 1 : 0),
  }));
}
