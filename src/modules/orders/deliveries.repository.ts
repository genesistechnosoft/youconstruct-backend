import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryCancelResolution,
  DeliveryStatus,
  FulfillmentStage,
  OrderRefundStatus,
  PaymentMethod,
  PaymentStatus,
  PlatformRole,
  Prisma,
  RestockStatus,
  SubOrderStatus,
  TransactionReason,
  TransactionType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { roundMoney } from '../../common/utils/money.util';
import { persistOrderFulfillment } from './fulfillment';
import { persistOrderPayment } from './payment-status';
import { ORDER_DETAIL_SELECT } from './orders.repository';

const DELIVERY_SELECT = {
  id: true,
  deliveryNumber: true,
  subOrderId: true,
  status: true,
  cancelResolution: true,
  trackingNumber: true,
  courierName: true,
  shippingLabelUrl: true,
  estimatedDelivery: true,
  shippedAt: true,
  deliveredAt: true,
  vendorRemarks: true,
  customerRemarks: true,
  overriddenByUserId: true,
  overrideReason: true,
  offlineAmountDue: true,
  offlineAmountCollected: true,
  walletCreditAmount: true,
  walletCreditedAt: true,
  lastUpdatedBy: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      orderItemId: true,
      quantity: true,
    },
  },
} as const;

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DRAFT,
  DeliveryStatus.SHIPPED,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.DELIVERED,
];

@Injectable()
export class DeliveriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.delivery.findUnique({
      where: { id },
      select: {
        ...DELIVERY_SELECT,
        subOrder: {
          select: {
            id: true,
            vendorId: true,
            status: true,
            orderId: true,
            subOrderNumber: true,
            subtotal: true,
            discountAmount: true,
            shippingCharge: true,
            onlineMerchandiseAmount: true,
            onlineShippingAmount: true,
            offlineMerchandiseAmount: true,
            platformCommission: true,
            vendorEarning: true,
            items: {
              select: {
                id: true,
                quantity: true,
                cancelledQuantity: true,
                unitPrice: true,
                discountAmount: true,
                total: true,
              },
            },
            order: {
              select: {
                id: true,
                userId: true,
                paymentMethod: true,
                addressPhone: true,
                user: { select: { phone: true } },
              },
            },
          },
        },
      },
    });
  }

  listForSubOrder(subOrderId: string) {
    return this.prisma.delivery.findMany({
      where: { subOrderId },
      orderBy: { createdAt: 'asc' },
      select: DELIVERY_SELECT,
    });
  }

  findSubOrderForVendor(subOrderId: string, vendorId: string) {
    return this.prisma.subOrder.findFirst({
      where: { id: subOrderId, vendorId, order: { deletedAt: null } },
      select: {
        id: true,
        vendorId: true,
        status: true,
        orderId: true,
        subOrderNumber: true,
        items: {
          select: {
            id: true,
            quantity: true,
            cancelledQuantity: true,
          },
        },
        deliveries: {
          select: {
            id: true,
            status: true,
            items: { select: { orderItemId: true, quantity: true } },
          },
        },
        order: {
          select: {
            id: true,
            userId: true,
            fulfillmentStage: true,
            paymentMethod: true,
            paymentStatus: true,
          },
        },
      },
    });
  }

  remainingQtyByItem(
    items: Array<{ id: string; quantity: number; cancelledQuantity: number }>,
    deliveries: Array<{
      status: DeliveryStatus;
      items: Array<{ orderItemId: string; quantity: number }>;
    }>,
  ): Map<string, number> {
    const remaining = new Map<string, number>();
    for (const item of items) {
      remaining.set(item.id, item.quantity - item.cancelledQuantity);
    }
    for (const delivery of deliveries) {
      if (!ACTIVE_DELIVERY_STATUSES.includes(delivery.status)) {
        continue;
      }
      for (const line of delivery.items) {
        remaining.set(
          line.orderItemId,
          (remaining.get(line.orderItemId) ?? 0) - line.quantity,
        );
      }
    }
    return remaining;
  }

  async createDraft(input: {
    subOrderId: string;
    deliveryNumber: string;
    actorUserId: string;
    items: Array<{ orderItemId: string; quantity: number }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.subOrder.findFirst({
        where: { id: input.subOrderId, order: { deletedAt: null } },
        select: {
          id: true,
          items: {
            select: { id: true, quantity: true, cancelledQuantity: true },
          },
          deliveries: {
            select: {
              status: true,
              items: { select: { orderItemId: true, quantity: true } },
            },
          },
        },
      });
      if (!so) {
        throw new NotFoundException('Sub-order not found');
      }

      const remaining = this.remainingQtyByItem(so.items, so.deliveries);
      for (const line of input.items) {
        const left = remaining.get(line.orderItemId) ?? -1;
        if (left < line.quantity) {
          throw new ConflictException('Delivery quantity exceeds remaining');
        }
        remaining.set(line.orderItemId, left - line.quantity);
      }

      return tx.delivery.create({
        data: {
          deliveryNumber: input.deliveryNumber,
          subOrderId: input.subOrderId,
          status: DeliveryStatus.DRAFT,
          lastUpdatedBy: input.actorUserId,
          items: {
            create: input.items.map((line) => ({
              orderItemId: line.orderItemId,
              quantity: line.quantity,
            })),
          },
        },
        select: DELIVERY_SELECT,
      });
    });
  }

  findCancellationContext(deliveryId: string) {
    return this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        deliveryNumber: true,
        status: true,
        items: {
          select: { orderItemId: true, quantity: true },
        },
        subOrder: {
          select: {
            id: true,
            orderId: true,
            subtotal: true,
            discountAmount: true,
            onlineMerchandiseAmount: true,
            onlineShippingAmount: true,
            items: {
              select: { id: true, quantity: true, total: true },
            },
            deliveries: {
              select: { id: true, status: true },
            },
            order: {
              select: {
                id: true,
                paymentStatus: true,
                razorpayPaymentId: true,
                onlineAmount: true,
              },
            },
          },
        },
      },
    });
  }

  async transitionDelivery(input: {
    deliveryId: string;
    fromStatus: DeliveryStatus;
    toStatus: DeliveryStatus;
    actorUserId: string;
    actorRole?: PlatformRole | null;
    trackingNumber?: string;
    courierName?: string;
    vendorRemarks?: string;
    customerRemarks?: string;
    overriddenByUserId?: string;
    overrideReason?: string;
    resolution?: DeliveryCancelResolution;
    reason?: string;
    refund?: {
      createRefund: boolean;
      refundAmount: Prisma.Decimal;
      razorpayRefundId?: string | null;
      providerPayload?: Prisma.InputJsonValue;
    };
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.toStatus === DeliveryStatus.CANCELLED && !input.resolution) {
        throw new ConflictException('Delivery cancel requires a resolution');
      }
      const prior = await tx.delivery.findUnique({
        where: { id: input.deliveryId },
        select: {
          subOrder: {
            select: {
              orderId: true,
              order: { select: { paymentStatus: true } },
            },
          },
        },
      });
      const updated = await tx.delivery.updateMany({
        where: { id: input.deliveryId, status: input.fromStatus },
        data: {
          status: input.toStatus,
          lastUpdatedBy: input.actorUserId,
          ...(input.trackingNumber !== undefined
            ? { trackingNumber: input.trackingNumber }
            : {}),
          ...(input.courierName !== undefined
            ? { courierName: input.courierName }
            : {}),
          ...(input.vendorRemarks !== undefined
            ? { vendorRemarks: input.vendorRemarks }
            : {}),
          ...(input.customerRemarks !== undefined
            ? { customerRemarks: input.customerRemarks }
            : {}),
          ...(input.overriddenByUserId
            ? {
                overriddenByUserId: input.overriddenByUserId,
                overrideReason: input.overrideReason,
              }
            : {}),
          ...(input.toStatus === DeliveryStatus.SHIPPED
            ? { shippedAt: new Date() }
            : {}),
          ...(input.toStatus === DeliveryStatus.DELIVERED
            ? { deliveredAt: new Date() }
            : {}),
          ...(input.toStatus === DeliveryStatus.CANCELLED && input.resolution
            ? { cancelResolution: input.resolution }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Delivery status was already changed');
      }

      if (input.toStatus === DeliveryStatus.DELIVERED) {
        await this.settleDelivered(tx, input.deliveryId);
      }
      if (
        input.toStatus === DeliveryStatus.CANCELLED &&
        input.resolution === DeliveryCancelResolution.REFUND
      ) {
        await this.cancelDeliveryUnits(tx, input.deliveryId);
        await this.recordRefundCancellation(tx, input);
      }
      if (
        input.toStatus === DeliveryStatus.CANCELLED &&
        input.resolution === DeliveryCancelResolution.REATTEMPT
      ) {
        await this.recordReattempt(tx, input);
      }

      const delivery = await tx.delivery.findUniqueOrThrow({
        where: { id: input.deliveryId },
        select: { subOrderId: true },
      });
      await this.recomputeFulfillment(tx, delivery.subOrderId);

      if (
        input.toStatus === DeliveryStatus.CANCELLED &&
        input.resolution === DeliveryCancelResolution.REFUND &&
        prior?.subOrder.order.paymentStatus === PaymentStatus.PENDING
      ) {
        const order = await tx.order.findUnique({
          where: { id: prior.subOrder.orderId },
          select: { fulfillmentStage: true },
        });
        if (order?.fulfillmentStage === FulfillmentStage.CANCELLED) {
          await tx.couponUsage.deleteMany({
            where: { orderId: prior.subOrder.orderId },
          });
        }
      }

      return tx.delivery.findUniqueOrThrow({
        where: { id: input.deliveryId },
        select: DELIVERY_SELECT,
      });
    });
  }

  async updateCustomerRemarks(deliveryId: string, customerRemarks: string) {
    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { customerRemarks },
      select: DELIVERY_SELECT,
    });
  }

  async recomputeFulfillmentForSubOrder(subOrderId: string) {
    return this.prisma.$transaction((tx) =>
      this.recomputeFulfillment(tx, subOrderId),
    );
  }

  private async settleDelivered(
    tx: Prisma.TransactionClient,
    deliveryId: string,
  ) {
    const delivery = await tx.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: {
        id: true,
        walletCreditedAt: true,
        items: { select: { orderItemId: true, quantity: true } },
        subOrder: {
          select: {
            id: true,
            vendorId: true,
            subtotal: true,
            discountAmount: true,
            onlineMerchandiseAmount: true,
            onlineShippingAmount: true,
            offlineMerchandiseAmount: true,
            platformCommission: true,
            vendorEarning: true,
            items: {
              select: {
                id: true,
                quantity: true,
                total: true,
              },
            },
            deliveries: {
              select: {
                id: true,
                status: true,
                walletCreditAmount: true,
                walletCreditedAt: true,
                offlineAmountCollected: true,
                items: { select: { orderItemId: true, quantity: true } },
              },
            },
            order: { select: { paymentMethod: true } },
          },
        },
      },
    });

    if (delivery.walletCreditedAt) {
      return;
    }

    const merchNet = Prisma.Decimal.max(
      delivery.subOrder.subtotal.sub(delivery.subOrder.discountAmount),
      new Prisma.Decimal(0),
    );
    const unitNet = new Map<string, Prisma.Decimal>();
    for (const item of delivery.subOrder.items) {
      const perUnit =
        item.quantity > 0
          ? item.total.div(item.quantity)
          : new Prisma.Decimal(0);
      unitNet.set(item.id, perUnit);
    }

    const sliceMerch = delivery.items.reduce((sum, line) => {
      const unit = unitNet.get(line.orderItemId) ?? new Prisma.Decimal(0);
      return sum.add(unit.mul(line.quantity));
    }, new Prisma.Decimal(0));

    const others = delivery.subOrder.deliveries.filter(
      (d) => d.id !== delivery.id,
    );
    const otherDelivered = others.filter(
      (d) => d.status === DeliveryStatus.DELIVERED,
    );
    const allocatedExceptThis = others
      .filter((d) => ACTIVE_DELIVERY_STATUSES.includes(d.status))
      .reduce(
        (sum, d) =>
          sum + d.items.reduce((lineSum, line) => lineSum + line.quantity, 0),
        0,
      );
    const thisQty = delivery.items.reduce(
      (sum, line) => sum + line.quantity,
      0,
    );
    const orderedQty = delivery.subOrder.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const cancelledQty = 0;
    const leftoverAfterThis =
      orderedQty - cancelledQty - allocatedExceptThis - thisQty;
    const isLast = leftoverAfterThis <= 0;

    const priorWallet = otherDelivered.reduce(
      (sum, d) => sum.add(d.walletCreditAmount),
      new Prisma.Decimal(0),
    );
    const priorOffline = otherDelivered.reduce(
      (sum, d) => sum.add(d.offlineAmountCollected),
      new Prisma.Decimal(0),
    );

    let walletCredit: Prisma.Decimal;
    if (isLast) {
      walletCredit = Prisma.Decimal.max(
        delivery.subOrder.vendorEarning.sub(priorWallet),
        new Prisma.Decimal(0),
      );
    } else {
      const merchPool = Prisma.Decimal.max(
        delivery.subOrder.onlineMerchandiseAmount.sub(
          delivery.subOrder.platformCommission,
        ),
        new Prisma.Decimal(0),
      );
      const merchShare = merchNet.greaterThan(0)
        ? roundMoney(sliceMerch.div(merchNet).mul(merchPool))
        : new Prisma.Decimal(0);
      const freight =
        otherDelivered.length === 0
          ? delivery.subOrder.onlineShippingAmount
          : new Prisma.Decimal(0);
      walletCredit = merchShare.add(freight);
    }

    let offlineDue = new Prisma.Decimal(0);
    if (delivery.subOrder.order.paymentMethod === PaymentMethod.COD) {
      if (isLast) {
        offlineDue = Prisma.Decimal.max(
          delivery.subOrder.offlineMerchandiseAmount.sub(priorOffline),
          new Prisma.Decimal(0),
        );
      } else if (merchNet.greaterThan(0)) {
        offlineDue = roundMoney(
          sliceMerch
            .div(merchNet)
            .mul(delivery.subOrder.offlineMerchandiseAmount),
        );
      }
    }

    if (walletCredit.greaterThan(0)) {
      const existingTx = await tx.vendorTransaction.findFirst({
        where: {
          reason: TransactionReason.ORDER_EARNING,
          referenceType: 'DELIVERY',
          referenceId: delivery.id,
        },
        select: { id: true },
      });
      if (!existingTx) {
        const wallet = await tx.vendorWallet.upsert({
          where: { vendorId: delivery.subOrder.vendorId },
          update: {},
          create: { vendorId: delivery.subOrder.vendorId },
          select: { id: true, balance: true, totalEarned: true },
        });
        const balanceBefore = wallet.balance;
        const balanceAfter = balanceBefore.add(walletCredit);
        await tx.vendorWallet.update({
          where: { id: wallet.id },
          data: {
            balance: balanceAfter,
            totalEarned: wallet.totalEarned.add(walletCredit),
          },
        });
        await tx.vendorTransaction.create({
          data: {
            vendorId: delivery.subOrder.vendorId,
            walletId: wallet.id,
            type: TransactionType.CREDIT,
            reason: TransactionReason.ORDER_EARNING,
            amount: walletCredit,
            balanceBefore,
            balanceAfter,
            referenceId: delivery.id,
            referenceType: 'DELIVERY',
            note: 'Delivery earning',
          },
        });
      }
    }

    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        offlineAmountDue: offlineDue,
        offlineAmountCollected: offlineDue,
        walletCreditAmount: walletCredit,
        walletCreditedAt: new Date(),
      },
    });

    const anyCredited = await tx.subOrder.findUnique({
      where: { id: delivery.subOrder.id },
      select: { walletCreditedAt: true },
    });
    if (!anyCredited?.walletCreditedAt) {
      await tx.subOrder.update({
        where: { id: delivery.subOrder.id },
        data: { walletCreditedAt: new Date() },
      });
    }
  }

  private async recomputeFulfillment(
    tx: Prisma.TransactionClient,
    subOrderId: string,
  ) {
    const so = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      select: { id: true, orderId: true },
    });

    await persistOrderFulfillment(tx, so.orderId);
    await persistOrderPayment(tx, so.orderId);
  }

  private async recordReattempt(
    tx: Prisma.TransactionClient,
    input: {
      deliveryId: string;
      actorUserId: string;
      reason?: string;
    },
  ) {
    const delivery = await tx.delivery.findUniqueOrThrow({
      where: { id: input.deliveryId },
      select: { subOrder: { select: { id: true, status: true } } },
    });
    await tx.orderStatusHistory.create({
      data: {
        subOrderId: delivery.subOrder.id,
        status: delivery.subOrder.status,
        changedByUserId: input.actorUserId,
        note: `Will ship again. ${input.reason ?? ''}`.trim(),
      },
    });
  }

  private async recordRefundCancellation(
    tx: Prisma.TransactionClient,
    input: {
      deliveryId: string;
      actorUserId: string;
      actorRole?: PlatformRole | null;
      reason?: string;
      refund?: {
        createRefund: boolean;
        refundAmount: Prisma.Decimal;
        razorpayRefundId?: string | null;
        providerPayload?: Prisma.InputJsonValue;
      };
    },
  ) {
    const delivery = await tx.delivery.findUniqueOrThrow({
      where: { id: input.deliveryId },
      select: {
        subOrder: {
          select: {
            id: true,
            orderId: true,
            status: true,
          },
        },
      },
    });
    const so = delivery.subOrder;
    const amount = input.refund?.refundAmount ?? new Prisma.Decimal(0);
    const createRefund = Boolean(
      input.refund?.createRefund && amount.greaterThan(0),
    );
    let refundId: string | undefined;
    if (createRefund && input.refund) {
      const refund = await tx.orderRefund.create({
        data: {
          orderId: so.orderId,
          subOrderId: so.id,
          amount,
          status: OrderRefundStatus.COMPLETED,
          reason: input.reason ?? 'Delivery refund',
          initiatedByUserId: input.actorUserId,
          razorpayRefundId: input.refund.razorpayRefundId ?? null,
          providerPayload: input.refund.providerPayload,
        },
        select: { id: true },
      });
      refundId = refund.id;
    }

    await tx.orderCancellation.create({
      data: {
        orderId: so.orderId,
        subOrderId: so.id,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? null,
        reason: input.reason ?? 'Delivery cancelled',
        restockStatus: RestockStatus.COMPLETED,
        refundId: refundId ?? null,
      },
    });

    const items = await tx.orderItem.findMany({
      where: { subOrderId: so.id },
      select: { quantity: true, cancelledQuantity: true },
    });
    const boxes = await tx.delivery.findMany({
      where: { subOrderId: so.id },
      select: {
        status: true,
        items: { select: { quantity: true } },
      },
    });
    const ordered = items.reduce((sum, item) => sum + item.quantity, 0);
    const cancelled = items.reduce(
      (sum, item) => sum + item.cancelledQuantity,
      0,
    );
    const delivered = boxes
      .filter((box) => box.status === DeliveryStatus.DELIVERED)
      .reduce(
        (sum, box) =>
          sum + box.items.reduce((lineSum, line) => lineSum + line.quantity, 0),
        0,
      );
    const stillToDeliver = ordered - cancelled - delivered > 0;
    const nextStatus =
      stillToDeliver || delivered > 0
        ? SubOrderStatus.PROCESSING
        : createRefund
          ? SubOrderStatus.REFUNDED
          : SubOrderStatus.CANCELLED;
    const closed =
      so.status === SubOrderStatus.CANCELLED ||
      so.status === SubOrderStatus.REFUNDED;
    if (!closed && so.status !== nextStatus) {
      await tx.subOrder.update({
        where: { id: so.id },
        data: { status: nextStatus },
      });
    }
    await tx.orderStatusHistory.create({
      data: {
        subOrderId: so.id,
        status: closed ? so.status : nextStatus,
        changedByUserId: input.actorUserId,
        note: createRefund
          ? `Refunded. ${input.reason ?? ''}`.trim()
          : `Cancelled. ${input.reason ?? ''}`.trim(),
      },
    });
  }

  private async cancelDeliveryUnits(
    tx: Prisma.TransactionClient,
    deliveryId: string,
  ) {
    const lines = await tx.deliveryItem.findMany({
      where: { deliveryId },
      select: {
        quantity: true,
        orderItem: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            cancelledQuantity: true,
          },
        },
      },
    });

    for (const line of lines) {
      const room = line.orderItem.quantity - line.orderItem.cancelledQuantity;
      const quantity = Math.min(line.quantity, Math.max(0, room));
      if (quantity <= 0) {
        continue;
      }
      await tx.orderItem.update({
        where: { id: line.orderItem.id },
        data: { cancelledQuantity: { increment: quantity } },
      });
      await tx.productInventory.updateMany({
        where: { variantId: line.orderItem.variantId },
        data: { quantity: { increment: quantity } },
      });
    }
  }

  async findOrderDetail(orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: ORDER_DETAIL_SELECT,
    });
  }
}
