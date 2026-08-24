export interface PackageKittingData {
  kittingRate: number;
  missingParts: string[];
  requiredQuantity?: number;
  scannedQuantity?: number;
}

export const PACKAGE_KITTING_RATE_EPSILON = 1e-9;

const isQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function isPackageKittingData(value: unknown): value is PackageKittingData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const rate = candidate.kittingRate;
  const missingParts = candidate.missingParts;
  const required = candidate.requiredQuantity;
  const scanned = candidate.scannedQuantity;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) return false;
  if (
    !Array.isArray(missingParts) ||
    !missingParts.every((part) => typeof part === 'string' && part.trim().length > 0)
  ) return false;
  const hasRequired = required !== undefined;
  const hasScanned = scanned !== undefined;
  if (hasRequired !== hasScanned) return false;
  if (hasRequired && hasScanned) {
    if (!isQuantity(required) || !isQuantity(scanned) || scanned > required) return false;
    if (required === 0) return scanned === 0 && rate === 1 && missingParts.length === 0;
    if (Math.abs(rate - scanned / required) > PACKAGE_KITTING_RATE_EPSILON) return false;
    if (rate === 1 && scanned !== required) return false;
    if (rate < 1 && scanned >= required) return false;
  }
  return rate === 1 ? missingParts.length === 0 : missingParts.length > 0;
}
