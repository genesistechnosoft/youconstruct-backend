import { Prisma } from '../../../generated/prisma/client.js';

type DecimalInput = Prisma.Decimal | string | number;

function toDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function formatMoney(value: DecimalInput): string {
  return toDecimal(value).toFixed(2);
}

export function formatRate(value: DecimalInput): string {
  return toDecimal(value).toFixed(4);
}

export function toPaise(value: DecimalInput): number {
  return Number(toDecimal(value).mul(100).toFixed(0));
}

export function roundMoney(value: DecimalInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Allocate `total` across shares; last entry absorbs remainder so the sum matches. */
export function allocateByShare(
  shares: Prisma.Decimal[],
  total: Prisma.Decimal,
): Prisma.Decimal[] {
  if (shares.length === 0) {
    return [];
  }
  const basis = shares.reduce(
    (sum, share) => sum.add(share),
    new Prisma.Decimal(0),
  );
  if (basis.lessThanOrEqualTo(0)) {
    return shares.map((_, index) =>
      index === shares.length - 1 ? roundMoney(total) : new Prisma.Decimal(0),
    );
  }

  const allocated: Prisma.Decimal[] = [];
  let running = new Prisma.Decimal(0);
  for (let i = 0; i < shares.length; i++) {
    if (i === shares.length - 1) {
      allocated.push(roundMoney(total.sub(running)));
      break;
    }
    const part = roundMoney(shares[i].div(basis).mul(total));
    allocated.push(part);
    running = running.add(part);
  }
  return allocated;
}
