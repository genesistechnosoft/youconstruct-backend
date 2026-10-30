import {
  DeliveryStatus,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';

/**
 * Vendor accept is PENDING → CONFIRMED. Packing is CONFIRMED → PROCESSING.
 * Shipment progress is stored on deliveries and rolled into fulfillmentStage.
 */
export const VENDOR_SUB_ORDER_TRANSITIONS: Record<
  SubOrderStatus,
  SubOrderStatus[]
> = {
  [SubOrderStatus.PENDING]: [SubOrderStatus.CONFIRMED],
  [SubOrderStatus.CONFIRMED]: [SubOrderStatus.PROCESSING],
  [SubOrderStatus.PROCESSING]: [],
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
