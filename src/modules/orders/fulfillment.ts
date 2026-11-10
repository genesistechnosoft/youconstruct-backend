import {
  DeliveryStatus,
  FulfillmentStage,
  Prisma,
} from '../../../generated/prisma/client.js';

export type FulfillmentCounts = {
  ordered: number;
  cancelled: number;
  preparing: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
};

export type FulfillmentSnapshot = FulfillmentCounts & {
  stage: FulfillmentStage;
  summary: string;
};

type DeliveryQty = {
  status: DeliveryStatus;
  items: Array<{ quantity: number; orderItemId?: string }>;
};

type ItemQty = {
  id?: string;
  quantity: number;
  cancelledQuantity: number;
};

export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

export function deriveFulfillment(input: {
  ordered: number;
  cancelled: number;
  delivered: number;
  inTransit: number;
  outForDelivery: number;
}): FulfillmentSnapshot {
  const ordered = input.ordered;
  const cancelled = input.cancelled;
  const delivered = input.delivered;
  const inTransit = input.inTransit;
  const outForDelivery = input.outForDelivery;
  const owed = Math.max(0, ordered - cancelled);
  const preparing = Math.max(0, owed - delivered - inTransit);
  const counts: FulfillmentCounts = {
    ordered,
    cancelled,
    preparing,
    inTransit,
    outForDelivery,
    delivered,
  };

  if (owed === 0) {
    return {
      ...counts,
      stage: FulfillmentStage.CANCELLED,
      summary:
        cancelled === 0 ? 'No items.' : `${itemsLabel(cancelled)} cancelled.`,
    };
  }

  if (delivered >= owed) {
    return {
      ...counts,
      stage: FulfillmentStage.DELIVERED,
      summary:
        cancelled > 0
          ? `${delivered} delivered · ${cancelled} cancelled.`
          : `${itemsLabel(delivered)} delivered.`,
    };
  }

  if (delivered > 0) {
    const parts = [`${delivered} of ${ordered} delivered`];
    if (inTransit > 0) parts.push(`${inTransit} on the way`);
    if (preparing > 0) parts.push(`${preparing} being prepared`);
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);
    return {
      ...counts,
      stage: FulfillmentStage.PARTIALLY_DELIVERED,
      summary: `${parts.join(' · ')}.`,
    };
  }

  if (outForDelivery >= owed) {
    return {
      ...counts,
      stage: FulfillmentStage.OUT_FOR_DELIVERY,
      summary: `${itemsLabel(owed)} out for delivery.`,
    };
  }

  if (inTransit >= owed) {
    const shippedOnly = Math.max(0, inTransit - outForDelivery);
    const summary =
      shippedOnly > 0 && outForDelivery > 0
        ? `${shippedOnly} shipped · ${outForDelivery} out for delivery.`
        : `${itemsLabel(owed)} on the way.`;
    return {
      ...counts,
      stage: FulfillmentStage.SHIPPED,
      summary,
    };
  }

  if (inTransit > 0) {
    const parts = [
      `${inTransit} of ${ordered} shipped`,
      `${preparing} being prepared`,
    ];
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);
    return {
      ...counts,
      stage: FulfillmentStage.PARTIALLY_SHIPPED,
      summary: `${parts.join(' · ')}.`,
    };
  }

  return {
    ...counts,
    stage: FulfillmentStage.PREPARING,
    summary:
      cancelled > 0
        ? `${itemsLabel(preparing)} being prepared · ${cancelled} cancelled.`
        : `${itemsLabel(preparing)} being prepared.`,
  };
}

export function sumFulfillmentCounts(
  snapshots: FulfillmentCounts[],
): FulfillmentSnapshot {
  const totals = snapshots.reduce(
    (sum, snapshot) => ({
      ordered: sum.ordered + snapshot.ordered,
      cancelled: sum.cancelled + snapshot.cancelled,
      delivered: sum.delivered + snapshot.delivered,
      inTransit: sum.inTransit + snapshot.inTransit,
      outForDelivery: sum.outForDelivery + snapshot.outForDelivery,
    }),
    {
      ordered: 0,
      cancelled: 0,
      delivered: 0,
      inTransit: 0,
      outForDelivery: 0,
    },
  );
  return deriveFulfillment(totals);
}

export function fulfillmentFromDeliveries(input: {
  items: ItemQty[];
  deliveries: DeliveryQty[];
}): FulfillmentSnapshot {
  const ordered = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const cancelled = input.items.reduce(
    (sum, item) => sum + item.cancelledQuantity,
    0,
  );
  let delivered = 0;
  let inTransit = 0;
  let outForDelivery = 0;
  for (const delivery of input.deliveries) {
    const qty = delivery.items.reduce((sum, item) => sum + item.quantity, 0);
    if (delivery.status === DeliveryStatus.DELIVERED) {
      delivered += qty;
    } else if (
      delivery.status === DeliveryStatus.SHIPPED ||
      delivery.status === DeliveryStatus.OUT_FOR_DELIVERY
    ) {
      inTransit += qty;
      if (delivery.status === DeliveryStatus.OUT_FOR_DELIVERY) {
        outForDelivery += qty;
      }
    }
  }
  return deriveFulfillment({
    ordered,
    cancelled,
    delivered,
    inTransit,
    outForDelivery,
  });
}

export function lineFulfillmentQuantities(
  item: ItemQty,
  deliveries: DeliveryQty[],
): {
  preparingQuantity: number;
  inTransitQuantity: number;
  deliveredQuantity: number;
} {
  let deliveredQuantity = 0;
  let inTransitQuantity = 0;
  for (const delivery of deliveries) {
    const qty = delivery.items
      .filter((line) => line.orderItemId === item.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (delivery.status === DeliveryStatus.DELIVERED) {
      deliveredQuantity += qty;
    } else if (
      delivery.status === DeliveryStatus.SHIPPED ||
      delivery.status === DeliveryStatus.OUT_FOR_DELIVERY
    ) {
      inTransitQuantity += qty;
    }
  }
  return {
    preparingQuantity: Math.max(
      0,
      item.quantity -
        item.cancelledQuantity -
        deliveredQuantity -
        inTransitQuantity,
    ),
    inTransitQuantity,
    deliveredQuantity,
  };
}

const FULFILLMENT_SOURCE_SELECT = {
  id: true,
  items: {
    select: { quantity: true, cancelledQuantity: true },
  },
  deliveries: {
    select: {
      status: true,
      items: { select: { quantity: true } },
    },
  },
} as const;

export async function persistOrderFulfillment(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<FulfillmentSnapshot> {
  const subOrders = await tx.subOrder.findMany({
    where: { orderId },
    select: FULFILLMENT_SOURCE_SELECT,
  });

  const snapshots = subOrders.map((subOrder) =>
    fulfillmentFromDeliveries({
      items: subOrder.items,
      deliveries: subOrder.deliveries,
    }),
  );

  for (let index = 0; index < subOrders.length; index += 1) {
    const snapshot = snapshots[index];
    await tx.subOrder.update({
      where: { id: subOrders[index].id },
      data: {
        fulfillmentStage: snapshot.stage,
        fulfillmentSummary: snapshot.summary,
      },
    });
  }

  const parent = sumFulfillmentCounts(snapshots);
  await tx.order.update({
    where: { id: orderId },
    data: {
      fulfillmentStage: parent.stage,
      fulfillmentSummary: parent.summary,
    },
  });
  return parent;
}
