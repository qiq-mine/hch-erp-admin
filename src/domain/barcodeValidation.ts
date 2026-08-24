export type BarcodeStage = 'reporting' | 'packaging' | 'inbound' | 'outbound';

export type BarcodeResult =
  | { valid: true; barcode: string }
  | {
      valid: false;
      code: 'duplicate' | 'wrong-process' | 'not-kitted' | 'already-outbound' | 'unknown';
      message: string;
    };

export interface BarcodeContext {
  seen: Set<string>;
  stage: BarcodeStage;
  known: Record<
    string,
    { process: BarcodeStage; kitted: boolean; outbound: boolean }
  >;
}

export function validateBarcode(input: string, context: BarcodeContext): BarcodeResult {
  const barcode = input.trim().toUpperCase();
  if (context.seen.has(barcode)) {
    return { valid: false, code: 'duplicate', message: '重复扫码' };
  }

  const item = context.known[barcode];
  if (!item) {
    return { valid: false, code: 'unknown', message: '条码不存在' };
  }
  if (item.process !== context.stage) {
    return { valid: false, code: 'wrong-process', message: '条码不属于当前工序' };
  }
  if (context.stage === 'outbound' && !item.kitted) {
    return { valid: false, code: 'not-kitted', message: '包件尚未齐套' };
  }
  if (context.stage === 'outbound' && item.outbound) {
    return { valid: false, code: 'already-outbound', message: '包件已出库' };
  }

  return { valid: true, barcode };
}
