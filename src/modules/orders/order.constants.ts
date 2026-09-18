import { Prisma } from '../../../generated/prisma/client.js';

export const DEFAULT_PLATFORM_COMMISSION_RATE = new Prisma.Decimal('0.10');
export const PAYMENT_TIMEOUT_MS = 30 * 60 * 1000;
export const PAYMENT_TIMEOUT_JOB_PREFIX = 'payment-timeout-';
