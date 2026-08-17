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
