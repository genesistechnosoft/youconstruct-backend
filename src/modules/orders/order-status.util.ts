import {
  DeliveryStatus,
  OrderStatus,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';

export const VENDOR_SUB_ORDER_TRANSITIONS: Record<
  SubOrderStatus,
  SubOrderStatus[]
> = {
  [SubOrderStatus.PENDING]: [],
  [SubOrderStatus.CONFIRMED]: [SubOrderStatus.PROCESSING],
  [SubOrderStatus.PROCESSING]: [],
  [SubOrderStatus.SHIPPED]: [],
  [SubOrderStatus.OUT_FOR_DELIVERY]: [],
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
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.SHIPPED]: [SubOrderStatus.CANCELLED, SubOrderStatus.REFUNDED],
  [SubOrderStatus.OUT_FOR_DELIVERY]: [
    SubOrderStatus.CANCELLED,
    SubOrderStatus.REFUNDED,
  ],
  [SubOrderStatus.DELIVERED]: [SubOrderStatus.REFUNDED],
  [SubOrderStatus.CANCELLED]: [],
  [SubOrderStatus.REFUNDED]: [],
};

export const VENDOR_DELIVERY_TRANSITIONS: Record<
  DeliveryStatus,
  DeliveryStatus[]
> = {
  [DeliveryStatus.DRAFT]: [DeliveryStatus.SHIPPED, DeliveryStatus.CANCELLED],
  [DeliveryStatus.SHIPPED]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: [],
};

export const ADMIN_DELIVERY_TRANSITIONS: Record<
  DeliveryStatus,
  DeliveryStatus[]
> = {
  [DeliveryStatus.DRAFT]: [
    DeliveryStatus.SHIPPED,
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.SHIPPED]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: [],
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

export function isVendorDeliveryTransitionAllowed(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return VENDOR_DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isAdminDeliveryTransitionAllowed(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return ADMIN_DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

const DISPATCHED_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.SHIPPED,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.DELIVERED,
];

export function isDeliveryDispatched(status: DeliveryStatus): boolean {
  return DISPATCHED_DELIVERY_STATUSES.includes(status);
}

export function isCustomerCancelAllowed(input: {
  orderCreatedAt: Date;
  windowHours: number;
  hasDispatchedDelivery: boolean;
  subOrderStatus: SubOrderStatus;
}): boolean {
  if (
    input.subOrderStatus === SubOrderStatus.CANCELLED ||
    input.subOrderStatus === SubOrderStatus.REFUNDED
  ) {
    return false;
  }
  if (input.hasDispatchedDelivery) {
    return false;
  }
  const deadline = new Date(
    input.orderCreatedAt.getTime() + input.windowHours * 60 * 60 * 1000,
  );
  return Date.now() < deadline.getTime();
}

export type SubOrderFulfillmentQty = {
  status: SubOrderStatus;
  orderedQty: number;
  cancelledQty: number;
  deliveredQty: number;
  dispatchedQty: number;
  allocatedQty: number;
};

export function remainingOpenQty(qty: SubOrderFulfillmentQty): number {
  return Math.max(0, qty.orderedQty - qty.cancelledQty - qty.allocatedQty);
}

export function deriveSubOrderStatusFromQty(
  qty: SubOrderFulfillmentQty,
): SubOrderStatus {
  if (qty.status === SubOrderStatus.REFUNDED) {
    return SubOrderStatus.REFUNDED;
  }
  const leftover = qty.orderedQty - qty.cancelledQty;
  if (leftover <= 0) {
    return SubOrderStatus.CANCELLED;
  }
  if (qty.deliveredQty >= leftover) {
    return SubOrderStatus.DELIVERED;
  }
  if (qty.dispatchedQty > 0 && qty.dispatchedQty >= leftover) {
    return qty.status === SubOrderStatus.OUT_FOR_DELIVERY
      ? SubOrderStatus.OUT_FOR_DELIVERY
      : SubOrderStatus.SHIPPED;
  }
  if (qty.dispatchedQty > 0) {
    return qty.status === SubOrderStatus.OUT_FOR_DELIVERY
      ? SubOrderStatus.OUT_FOR_DELIVERY
      : SubOrderStatus.SHIPPED;
  }
  if (
    qty.status === SubOrderStatus.PENDING ||
    qty.status === SubOrderStatus.CANCELLED ||
    qty.status === SubOrderStatus.DELIVERED ||
    qty.status === SubOrderStatus.SHIPPED ||
    qty.status === SubOrderStatus.OUT_FOR_DELIVERY
  ) {
    return qty.status === SubOrderStatus.PENDING
      ? SubOrderStatus.PENDING
      : SubOrderStatus.CONFIRMED;
  }
  return qty.status;
}

export function aggregateParentOrderStatusFromQty(
  subOrders: SubOrderFulfillmentQty[],
): OrderStatus {
  if (subOrders.length === 0) {
    return OrderStatus.CONFIRMED;
  }
  if (subOrders.every((s) => s.status === SubOrderStatus.REFUNDED)) {
    return OrderStatus.REFUNDED;
  }
  if (
    subOrders.every(
      (s) =>
        s.status === SubOrderStatus.CANCELLED ||
        s.status === SubOrderStatus.REFUNDED,
    )
  ) {
    return subOrders.some((s) => s.status === SubOrderStatus.REFUNDED)
      ? OrderStatus.REFUNDED
      : OrderStatus.CANCELLED;
  }

  const active = subOrders.filter(
    (s) =>
      s.status !== SubOrderStatus.CANCELLED &&
      s.status !== SubOrderStatus.REFUNDED,
  );
  const leftover = active.reduce(
    (sum, s) => sum + Math.max(0, s.orderedQty - s.cancelledQty),
    0,
  );
  const delivered = active.reduce((sum, s) => sum + s.deliveredQty, 0);
  const dispatched = active.reduce((sum, s) => sum + s.dispatchedQty, 0);
  const remainingAfterDelivery = leftover - delivered;

  if (leftover > 0 && delivered >= leftover) {
    return OrderStatus.DELIVERED;
  }
  if (remainingAfterDelivery > 0 && dispatched > 0) {
    return OrderStatus.PARTIALLY_SHIPPED;
  }
  if (dispatched > 0 && remainingAfterDelivery <= 0) {
    return OrderStatus.SHIPPED;
  }
  if (active.every((s) => s.status === SubOrderStatus.PENDING)) {
    return OrderStatus.PENDING_PAYMENT;
  }
  return OrderStatus.CONFIRMED;
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
