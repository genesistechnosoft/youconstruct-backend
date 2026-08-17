import {
  OrderStatus,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';

export const VENDOR_SUB_ORDER_TRANSITIONS: Record<
  SubOrderStatus,
  SubOrderStatus[]
> = {
  [SubOrderStatus.PENDING]: [],
  [SubOrderStatus.CONFIRMED]: [SubOrderStatus.PROCESSING],
  [SubOrderStatus.PROCESSING]: [SubOrderStatus.SHIPPED],
  [SubOrderStatus.SHIPPED]: [SubOrderStatus.OUT_FOR_DELIVERY],
  [SubOrderStatus.OUT_FOR_DELIVERY]: [SubOrderStatus.DELIVERED],
  [SubOrderStatus.DELIVERED]: [],
  [SubOrderStatus.CANCELLED]: [],
  [SubOrderStatus.REFUNDED]: [],
};

export const ADMIN_SUB_ORDER_TRANSITIONS: Record<
  SubOrderStatus,
  SubOrderStatus[]
> = {
  [SubOrderStatus.PENDING]: [
    SubOrderStatus.CONFIRMED,
    SubOrderStatus.CANCELLED,
  ],
  [SubOrderStatus.CONFIRMED]: [
    SubOrderStatus.PROCESSING,
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.PROCESSING]: [
    SubOrderStatus.SHIPPED,
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.SHIPPED]: [
    SubOrderStatus.OUT_FOR_DELIVERY,
    SubOrderStatus.DELIVERED,
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.OUT_FOR_DELIVERY]: [
    SubOrderStatus.DELIVERED,
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.DELIVERED]: [SubOrderStatus.REFUNDED],
  [SubOrderStatus.CANCELLED]: [],
  [SubOrderStatus.REFUNDED]: [],
};

const SHIPPED_OR_LATER: SubOrderStatus[] = [
  SubOrderStatus.SHIPPED,
  SubOrderStatus.OUT_FOR_DELIVERY,
  SubOrderStatus.DELIVERED,
];

const EARLIER_ACTIVE: SubOrderStatus[] = [
  SubOrderStatus.PENDING,
  SubOrderStatus.CONFIRMED,
  SubOrderStatus.PROCESSING,
];

export function aggregateParentOrderStatus(
  statuses: SubOrderStatus[],
): OrderStatus {
  if (statuses.length === 0) {
    return OrderStatus.CONFIRMED;
  }

  if (statuses.every((s) => s === SubOrderStatus.CANCELLED)) {
    return OrderStatus.CANCELLED;
  }

  if (statuses.every((s) => s === SubOrderStatus.REFUNDED)) {
    return OrderStatus.REFUNDED;
  }

  const active = statuses.filter(
    (s) => s !== SubOrderStatus.CANCELLED && s !== SubOrderStatus.REFUNDED,
  );

  if (active.length === 0) {
    return OrderStatus.CANCELLED;
  }

  if (active.every((s) => s === SubOrderStatus.DELIVERED)) {
    return OrderStatus.DELIVERED;
  }

  if (active.every((s) => SHIPPED_OR_LATER.includes(s))) {
    return OrderStatus.SHIPPED;
  }

  const someShippedOrLater = active.some((s) => SHIPPED_OR_LATER.includes(s));
  const someEarlier = active.some((s) => EARLIER_ACTIVE.includes(s));

  if (someShippedOrLater && someEarlier) {
    return OrderStatus.PARTIALLY_SHIPPED;
  }

  if (active.every((s) => s === SubOrderStatus.PENDING)) {
    return OrderStatus.PENDING_PAYMENT;
  }

  return OrderStatus.CONFIRMED;
}

export function isVendorTransitionAllowed(
  from: SubOrderStatus,
  to: SubOrderStatus,
): boolean {
  return VENDOR_SUB_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isAdminTransitionAllowed(
  from: SubOrderStatus,
  to: SubOrderStatus,
): boolean {
  return ADMIN_SUB_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

const SUB_ORDER_STATUS_RANK: Record<SubOrderStatus, number> = {
  [SubOrderStatus.PENDING]: 0,
  [SubOrderStatus.CONFIRMED]: 1,
  [SubOrderStatus.PROCESSING]: 2,
  [SubOrderStatus.SHIPPED]: 3,
  [SubOrderStatus.OUT_FOR_DELIVERY]: 4,
  [SubOrderStatus.DELIVERED]: 5,
  [SubOrderStatus.CANCELLED]: 100,
  [SubOrderStatus.REFUNDED]: 100,
};

/**
 * Cancel is allowed for statuses strictly before the configured cutoff.
 * Default cutoff SHIPPED → PENDING, CONFIRMED, PROCESSING.
 */
export function isCancelAllowedBeforeCutoff(
  current: SubOrderStatus,
  cutoffStatus: string,
): boolean {
  if (
    current === SubOrderStatus.CANCELLED ||
    current === SubOrderStatus.REFUNDED
  ) {
    return false;
  }

  const cutoff = (Object.values(SubOrderStatus) as string[]).includes(
    cutoffStatus,
  )
    ? (cutoffStatus as SubOrderStatus)
    : SubOrderStatus.SHIPPED;

  return SUB_ORDER_STATUS_RANK[current] < SUB_ORDER_STATUS_RANK[cutoff];
}
