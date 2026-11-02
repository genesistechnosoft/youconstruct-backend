import {
  OrderRefundStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../../../generated/prisma/client.js';

export function resolveOrderPayment(input: {
  method: PaymentMethod;
  captured: boolean;
  onlineAmount: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  ordered: number;
  cancelled: number;
  delivered: number;
}): PaymentStatus {
  const owed = Math.max(0, input.ordered - input.cancelled);
  const goodsRemain = owed > 0;
  const hasRefund = input.refundedAmount.greaterThan(0);

  if (hasRefund) {
    const coversCaptured =
      !input.captured ||
      input.refundedAmount.greaterThanOrEqualTo(input.onlineAmount);
    const stillToDeliver =
      input.ordered - input.cancelled - input.delivered > 0;
    if (coversCaptured && !stillToDeliver) {
      return PaymentStatus.REFUNDED;
    }
    return PaymentStatus.PARTIALLY_REFUNDED;
  }

  if (!input.captured) {
    return goodsRemain ? PaymentStatus.PENDING : PaymentStatus.FAILED;
  }

  if (input.method === PaymentMethod.COD && input.delivered < owed) {
    return PaymentStatus.PARTIALLY_PAID;
  }

  return PaymentStatus.PAID;
}

export async function persistOrderPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PaymentStatus> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      paymentMethod: true,
      onlineAmount: true,
      razorpayPaymentId: true,
      subOrders: {
        select: {
          items: { select: { quantity: true, cancelledQuantity: true } },
          deliveries: {
            select: {
              status: true,
              items: { select: { quantity: true } },
            },
          },
        },
      },
      refunds: {
        where: { status: OrderRefundStatus.COMPLETED },
        select: { amount: true },
      },
    },
  });

  let ordered = 0;
  let cancelled = 0;
  let delivered = 0;
  for (const subOrder of order.subOrders) {
    for (const item of subOrder.items) {
      ordered += item.quantity;
      cancelled += item.cancelledQuantity;
    }
    for (const delivery of subOrder.deliveries) {
      if (delivery.status !== 'DELIVERED') {
        continue;
      }
      delivered += delivery.items.reduce((sum, line) => sum + line.quantity, 0);
    }
  }

  const refundedAmount = order.refunds.reduce(
    (sum, refund) => sum.add(refund.amount),
    new Prisma.Decimal(0),
  );

  const paymentStatus = resolveOrderPayment({
    method: order.paymentMethod,
    captured: Boolean(order.razorpayPaymentId),
    onlineAmount: order.onlineAmount,
    refundedAmount,
    ordered,
    cancelled,
    delivered,
  });

  await tx.order.update({
    where: { id: orderId },
    data: { paymentStatus },
  });

  return paymentStatus;
}
