import { describe, expect, it } from 'vitest';
import { validateBarcode, type BarcodeContext } from './barcodeValidation';

const context: BarcodeContext = {
  seen: new Set(['PKG-260822-DUP']),
  stage: 'outbound',
  known: {
    'PKG-260822-001': { process: 'outbound', kitted: true, outbound: false },
    'PART-WRONG-001': { process: 'reporting', kitted: true, outbound: false },
    'PKG-NOT-KITTED': { process: 'outbound', kitted: false, outbound: false },
    'PKG-OUT-001': { process: 'outbound', kitted: true, outbound: true },
  },
};

describe('validateBarcode', () => {
  it.each([
    ['PKG-260822-DUP', 'duplicate'],
    ['PART-WRONG-001', 'wrong-process'],
    ['PKG-NOT-KITTED', 'not-kitted'],
    ['PKG-OUT-001', 'already-outbound'],
  ] as const)('returns %s as %s', (barcode, code) => {
    expect(validateBarcode(barcode, context)).toMatchObject({ valid: false, code });
  });

  it('rejects an unknown barcode', () => {
    expect(validateBarcode('PKG-UNKNOWN-001', context)).toMatchObject({
      valid: false,
      code: 'unknown',
    });
  });

  it('normalizes and accepts a valid barcode', () => {
    expect(validateBarcode(' pkg-260822-001 ', context)).toEqual({
      valid: true,
      barcode: 'PKG-260822-001',
    });
  });

  const precedenceCases: Array<{
    code: 'duplicate' | 'unknown' | 'wrong-process' | 'not-kitted' | 'already-outbound';
    input: string;
    context: BarcodeContext;
  }> = [
    {
      code: 'duplicate',
      input: 'DUPLICATE-CONFLICT',
      context: {
        seen: new Set(['DUPLICATE-CONFLICT']),
        stage: 'outbound',
        known: {
          'DUPLICATE-CONFLICT': { process: 'reporting', kitted: false, outbound: true },
        },
      },
    },
    {
      code: 'unknown',
      input: 'UNKNOWN-CONFLICT',
      context: {
        seen: new Set<string>(),
        stage: 'outbound',
        known: {},
      },
    },
    {
      code: 'wrong-process',
      input: 'WRONG-PROCESS-CONFLICT',
      context: {
        seen: new Set<string>(),
        stage: 'outbound',
        known: {
          'WRONG-PROCESS-CONFLICT': { process: 'reporting', kitted: false, outbound: true },
        },
      },
    },
    {
      code: 'not-kitted',
      input: 'NOT-KITTED-CONFLICT',
      context: {
        seen: new Set<string>(),
        stage: 'outbound',
        known: {
          'NOT-KITTED-CONFLICT': { process: 'outbound', kitted: false, outbound: true },
        },
      },
    },
    {
      code: 'already-outbound',
      input: 'ALREADY-OUTBOUND-CONFLICT',
      context: {
        seen: new Set<string>(),
        stage: 'outbound',
        known: {
          'ALREADY-OUTBOUND-CONFLICT': { process: 'outbound', kitted: true, outbound: true },
        },
      },
    },
  ];

  it.each(precedenceCases)('applies rejection precedence and returns $code', ({ code, input, context }) => {
    expect(validateBarcode(input, context)).toMatchObject({ valid: false, code });
  });

  it('does not mutate the validation context', () => {
    const original = structuredClone(context);

    validateBarcode(' PKG-260822-001 ', context);
    validateBarcode('PKG-260822-DUP', context);
    validateBarcode('PKG-UNKNOWN-001', context);

    expect(context).toEqual(original);
  });
});
