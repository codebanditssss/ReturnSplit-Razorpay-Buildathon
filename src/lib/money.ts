import type { Paise } from "./types";

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function isPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertPaise(value: number, label = "amount"): asserts value is Paise {
  if (!isPaise(value)) {
    throw new RangeError(`${label} must be a non-negative safe integer number of paise`);
  }
}

export function paise(value: number, label = "amount"): Paise {
  assertPaise(value, label);
  return value;
}

export function formatPaise(value: Paise): string {
  assertPaise(value);
  return INR_FORMATTER.format(value / 100);
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${label} is outside the supported paise range`);
  }
  return result;
}

/** Exact half-up multiplication for basis-point and other rational splits. */
export function multiplyRatioHalfUp(
  amountPaise: Paise,
  numerator: number,
  denominator: number,
): Paise {
  assertPaise(amountPaise);
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError("numerator must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("denominator must be a positive safe integer");
  }

  const amount = BigInt(amountPaise);
  const top = amount * BigInt(numerator);
  const bottom = BigInt(denominator);
  const rounded = (top * BigInt(2) + bottom) / (bottom * BigInt(2));
  return safeNumber(rounded, "ratio result");
}

export interface WeightedPaiseAllocation {
  id: string;
  amountPaise: Paise;
}

/**
 * Largest-remainder allocation. Fractions are compared exactly and stable IDs
 * break ties, making the result repeatable across runtimes and retries.
 */
export function allocatePaiseProRata(
  totalPaise: Paise,
  weights: readonly { id: string; weight: number }[],
): readonly WeightedPaiseAllocation[] {
  assertPaise(totalPaise, "allocation total");
  if (weights.length === 0) {
    if (totalPaise === 0) return [];
    throw new RangeError("cannot allocate a positive amount without weights");
  }

  const seen = new Set<string>();
  for (const entry of weights) {
    if (!entry.id || seen.has(entry.id)) {
      throw new RangeError("allocation IDs must be non-empty and unique");
    }
    seen.add(entry.id);
    if (!Number.isSafeInteger(entry.weight) || entry.weight < 0) {
      throw new RangeError(`weight for ${entry.id} must be a non-negative safe integer`);
    }
  }

  const totalWeight = weights.reduce((sum, entry) => sum + BigInt(entry.weight), BigInt(0));
  if (totalWeight === BigInt(0)) {
    if (totalPaise === 0) return weights.map(({ id }) => ({ id, amountPaise: 0 }));
    throw new RangeError("cannot allocate a positive amount across zero total weight");
  }

  const total = BigInt(totalPaise);
  const provisional = weights.map((entry) => {
    const product = total * BigInt(entry.weight);
    return {
      id: entry.id,
      amount: product / totalWeight,
      remainder: product % totalWeight,
    };
  });
  const allocated = provisional.reduce((sum, entry) => sum + entry.amount, BigInt(0));
  const residual = safeNumber(total - allocated, "allocation residual");

  const remainderOrder = [...provisional].sort((a, b) => {
    if (a.remainder === b.remainder) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.remainder > b.remainder ? -1 : 1;
  });
  const increments = new Set(remainderOrder.slice(0, residual).map(({ id }) => id));

  return provisional.map((entry) => ({
    id: entry.id,
    amountPaise: safeNumber(entry.amount + (increments.has(entry.id) ? BigInt(1) : BigInt(0)), "allocation"),
  }));
}

export function sumPaise(values: readonly Paise[], label = "sum"): Paise {
  const total = values.reduce((sum, value) => {
    assertPaise(value, label);
    return sum + BigInt(value);
  }, BigInt(0));
  return safeNumber(total, label);
}
