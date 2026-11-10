import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  DeliveryStatus,
  NotificationEventType,
  OrderRefundStatus,
  PaymentStatus,
  PlatformRole,
  Prisma,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import {
  domainBadRequest,
  domainConflict,
} from '../../common/errors/domain-exception';
import { roundMoney, toPaise } from '../../common/utils/money.util';
import { RazorpayClient } from '../payments/razorpay.client';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  isCustomerCancelAllowed,
  isDeliveryDispatched,
} from './order-status.util';
import { DeliveriesRepository } from './deliveries.repository';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

export type DeliveryRefundCapture = {
  createRefund: boolean;
  refundAmount: Prisma.Decimal;
  razorpayRefundId: string | null;
  providerPayload?: Prisma.InputJsonValue;
};

type CancelAudience = 'customer' | 'vendor' | 'admin' | 'system';
type CancelSubOrderRow = NonNullable<
  Awaited<ReturnType<OrdersRepository['findSubOrderForCancelRefund']>>
>;

@Injectable()
export class CancelRefundService {
  private readonly logger = new Logger(CancelRefundService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly platformSettings: PlatformSettingsService,
    @Inject(forwardRef(() => RazorpayClient))
    private readonly razorpayClient: RazorpayClient,
    private readonly notifications: NotificationEmitterService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  async cancelSubOrder(input: {
    subOrderId: string;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    audience: CancelAudience;
    reason: string;
    orderId?: string;
    vendorId?: string;
  }) {
    const started = Date.now();
    let ok = false;
    try {
      const result = await this.executeCancelSubOrder(input);
      ok = true;
      return result;
    } finally {
      this.logger.log(
        `cancel_refund durationMs=${Date.now() - started} subOrderId=${input.subOrderId} ${ok ? 'ok' : 'fail'}`,
      );
    }
  }

  private async executeCancelSubOrder(input: {
    subOrderId: string;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    audience: CancelAudience;
    reason: string;
    orderId?: string;
    vendorId?: string;
  }) {
    const so = await this.ordersRepository.findSubOrderForCancelRefund(
      input.subOrderId,
    );
    if (!so) {
      throw new NotFoundException('Sub-order not found');
    }

    if (input.orderId && so.orderId !== input.orderId) {
      throw new NotFoundException('Sub-order not found');
    }
    if (input.vendorId && so.vendorId !== input.vendorId) {
      throw new NotFoundException('Sub-order not found');
    }
    if (
      input.audience === 'customer' &&
      input.actorUserId &&
      so.order.userId !== input.actorUserId
    ) {
      throw new NotFoundException('Sub-order not found');
    }

    if (
      so.status === SubOrderStatus.CANCELLED ||
      so.status === SubOrderStatus.REFUNDED
    ) {
      throw domainConflict(
        DOMAIN_ERROR_CODES.ALREADY_CANCELLED,
        'Sub-order is already cancelled or refunded',
      );
    }

    const hasDispatched = so.deliveries.some((d) =>
      isDeliveryDispatched(d.status),
    );

    if (input.audience === 'customer') {
      const windowHours = await this.platformSettings.getNumber(
        'commerce',
        'customerCancelWindowHours',
      );
      if (
        !isCustomerCancelAllowed({
          orderCreatedAt: so.order.createdAt,
          windowHours: windowHours > 0 ? windowHours : 24,
          hasDispatchedDelivery: hasDispatched,
          subOrderStatus: so.status,
        })
      ) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.CANCEL_WINDOW_EXPIRED,
          'Cancellation is no longer allowed for this sub-order',
        );
      }
    }

    const remaining = this.remainingUndelivered(so);
    if (remaining.qty <= 0) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CANCEL_NOT_ALLOWED,
        'No remaining undelivered quantity to cancel',
      );
    }

    const captured = this.isCaptured(so);
    if (captured) {
      return this.refundSubOrderInternal({
        so,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reason: input.reason,
        fromCancel: true,
        audience: input.audience,
        vendorId: input.vendorId,
      });
    }

    const result = await this.ordersRepository.applySubOrderCancelOrRefund({
      subOrderId: so.id,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      reason: input.reason,
      targetStatus: SubOrderStatus.CANCELLED,
      restock: true,
      clawbackWallet: false,
      createRefund: false,
    });

    this.notifications.emit({
      userId: so.order.userId,
      eventType: NotificationEventType.ORDER_CANCELLED,
      title: 'Order cancelled',
      body: `Sub-order cancelled: ${input.reason}`,
      data: {
        orderId: so.orderId,
        subOrderId: so.id,
      },
    });

    const order = await this.ordersRepository.findOrderById(result.orderId);
    return {
      message: 'Sub-order cancelled successfully',
      data: this.ordersService.serializeOrderForAudience(
        order!,
        input.audience === 'vendor'
          ? 'vendor'
          : input.audience === 'admin'
            ? 'admin'
            : 'customer',
        input.vendorId,
      ),
    };
  }

  async adminRefundOrder(input: {
    orderId: string;
    actorUserId: string;
    note?: string;
    subOrderId?: string;
  }) {
    const order = await this.ordersRepository.findOrderById(input.orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const targets = input.subOrderId
      ? order.subOrders.filter((so) => so.id === input.subOrderId)
      : order.subOrders;

    if (targets.length === 0) {
      throw new NotFoundException('Sub-order not found');
    }

    const refundable = targets.filter(
      (so) =>
        so.status !== SubOrderStatus.CANCELLED &&
        so.status !== SubOrderStatus.REFUNDED,
    );
    if (refundable.length === 0) {
      throw domainConflict(
        DOMAIN_ERROR_CODES.ALREADY_CANCELLED,
        'No refundable sub-orders found',
      );
    }

    let refundedAny = false;

    for (const target of refundable) {
      const so = await this.ordersRepository.findSubOrderForCancelRefund(
        target.id,
      );
      if (!so) {
        continue;
      }

      const remaining = this.remainingUndelivered(so);
      if (remaining.qty <= 0) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
          'Delivered quantity must be returned instead of refunded',
        );
      }

      const captured = this.isCaptured(so);
      if (!captured) {
        await this.ordersRepository.applySubOrderCancelOrRefund({
          subOrderId: so.id,
          actorUserId: input.actorUserId,
          actorRole: PlatformRole.ADMIN,
          reason: input.note ?? 'Admin cancel',
          targetStatus: SubOrderStatus.CANCELLED,
          restock: true,
          clawbackWallet: false,
          createRefund: false,
        });
        continue;
      }

      refundedAny = true;
      await this.refundSubOrderInternal({
        so,
        actorUserId: input.actorUserId,
        actorRole: PlatformRole.ADMIN,
        reason: input.note ?? 'Admin refund',
        fromCancel: false,
        audience: 'admin',
      });
    }

    const refreshed = await this.ordersRepository.findOrderById(input.orderId);
    return {
      message: refundedAny
        ? 'Refund completed successfully'
        : 'Order cancelled',
      data: this.ordersService.serializeOrderForAudience(refreshed!, 'admin'),
    };
  }

  private async refundSubOrderInternal(input: {
    so: CancelSubOrderRow;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    reason: string;
    fromCancel: boolean;
    audience: CancelAudience;
    vendorId?: string;
  }) {
    const started = Date.now();
    let ok = false;
    try {
      const result = await this.executeRefundSubOrder(input);
      ok = true;
      return result;
    } finally {
      if (!input.fromCancel) {
        this.logger.log(
          `cancel_refund durationMs=${Date.now() - started} subOrderId=${input.so.id} ${ok ? 'ok' : 'fail'}`,
        );
      }
    }
  }

  private async executeRefundSubOrder(input: {
    so: CancelSubOrderRow;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    reason: string;
    fromCancel: boolean;
    audience: CancelAudience;
    vendorId?: string;
  }) {
    const paymentId = input.so.order.razorpayPaymentId;
    if (!paymentId) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
        'Missing Razorpay payment id for refund',
      );
    }

    const computed = this.computeOnlineRefund(input.so);
    const already = await this.ordersRepository.sumCompletedRefunds(
      input.so.orderId,
    );
    const remainingCap = Prisma.Decimal.max(
      input.so.order.onlineAmount.sub(already),
      new Prisma.Decimal(0),
    );
    const refundAmount = Prisma.Decimal.min(computed, remainingCap);
    if (refundAmount.lessThanOrEqualTo(0)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
        'No remaining refundable online amount',
      );
    }

    const amountPaise = toPaise(refundAmount);
    let razorpayRefundId: string | null = null;
    let providerPayload: Prisma.InputJsonValue | undefined;

    try {
      const refund = await this.razorpayClient.createRefund({
        paymentId,
        amountPaise,
        notes: {
          orderId: input.so.orderId,
          subOrderId: input.so.id,
          reason: input.reason.slice(0, 100),
        },
      });
      razorpayRefundId = refund.id;
      providerPayload = refund.payload as Prisma.InputJsonValue;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refund failed';
      await this.ordersRepository.markRefundFailed({
        orderId: input.so.orderId,
        subOrderId: input.so.id,
        actorUserId: input.actorUserId,
        amount: refundAmount,
        reason: message,
      });
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
        `Razorpay refund failed: ${message}`,
      );
    }

    await this.ordersRepository.applySubOrderCancelOrRefund({
      subOrderId: input.so.id,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      reason: input.reason,
      targetStatus: input.fromCancel
        ? SubOrderStatus.CANCELLED
        : SubOrderStatus.REFUNDED,
      restock: true,
      clawbackWallet: false,
      createRefund: true,
      refundAmount,
      razorpayRefundId,
      providerPayload,
      refundStatus: OrderRefundStatus.COMPLETED,
    });

    this.notifications.emit({
      userId: input.so.order.userId,
      eventType: input.fromCancel
        ? NotificationEventType.ORDER_CANCELLED
        : NotificationEventType.ORDER_REFUNDED,
      title: input.fromCancel ? 'Order cancelled' : 'Order refunded',
      body: input.reason,
      data: {
        orderId: input.so.orderId,
        subOrderId: input.so.id,
        razorpayRefundId,
      },
    });

    const order = await this.ordersRepository.findOrderById(input.so.orderId);
    const audience =
      input.audience === 'vendor'
        ? 'vendor'
        : input.audience === 'customer'
          ? 'customer'
          : 'admin';
    return {
      message: input.fromCancel
        ? 'Sub-order cancelled and refunded successfully'
        : 'Sub-order refunded successfully',
      data: this.ordersService.serializeOrderForAudience(
        order!,
        audience,
        input.vendorId,
      ),
    };
  }

  async captureDeliveryRefund(input: {
    deliveryId: string;
    actorUserId: string;
    reason: string;
  }): Promise<DeliveryRefundCapture> {
    const delivery = await this.deliveriesRepository.findCancellationContext(
      input.deliveryId,
    );
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    const none: DeliveryRefundCapture = {
      createRefund: false,
      refundAmount: new Prisma.Decimal(0),
      razorpayRefundId: null,
    };
    const order = delivery.subOrder.order;
    const captured =
      Boolean(order.razorpayPaymentId) &&
      (order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED);
    if (!captured || !order.razorpayPaymentId) {
      return none;
    }

    const refundAmount = await this.deliveryRefundAmount(delivery);
    if (refundAmount.lessThanOrEqualTo(0)) {
      return none;
    }

    const amountPaise = toPaise(refundAmount);
    try {
      const refund = await this.razorpayClient.createRefund({
        paymentId: order.razorpayPaymentId,
        amountPaise,
        notes: {
          orderId: delivery.subOrder.orderId,
          subOrderId: delivery.subOrder.id,
          deliveryId: delivery.id,
          reason: input.reason.slice(0, 100),
        },
      });
      return {
        createRefund: true,
        refundAmount,
        razorpayRefundId: refund.id,
        providerPayload: refund.payload as Prisma.InputJsonValue,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refund failed';
      await this.ordersRepository.markRefundFailed({
        orderId: delivery.subOrder.orderId,
        subOrderId: delivery.subOrder.id,
        actorUserId: input.actorUserId,
        amount: refundAmount,
        reason: message,
      });
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
        `Razorpay refund failed: ${message}`,
      );
    }
  }

  private async deliveryRefundAmount(delivery: {
    id: string;
    items: Array<{ orderItemId: string; quantity: number }>;
    subOrder: {
      orderId: string;
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      onlineMerchandiseAmount: Prisma.Decimal;
      onlineShippingAmount: Prisma.Decimal;
      items: Array<{ id: string; quantity: number; total: Prisma.Decimal }>;
      deliveries: Array<{ id: string; status: DeliveryStatus }>;
      order: { onlineAmount: Prisma.Decimal };
    };
  }): Promise<Prisma.Decimal> {
    const so = delivery.subOrder;
    const merchNet = Prisma.Decimal.max(
      so.subtotal.sub(so.discountAmount),
      new Prisma.Decimal(0),
    );
    let slice = new Prisma.Decimal(0);
    for (const line of delivery.items) {
      const item = so.items.find((row) => row.id === line.orderItemId);
      if (!item || item.quantity <= 0) {
        continue;
      }
      slice = slice.add(item.total.div(item.quantity).mul(line.quantity));
    }
    const merchRefund = merchNet.greaterThan(0)
      ? roundMoney(slice.div(merchNet).mul(so.onlineMerchandiseAmount))
      : new Prisma.Decimal(0);
    const otherDispatched = so.deliveries.some(
      (box) => box.id !== delivery.id && isDeliveryDispatched(box.status),
    );
    const freight = otherDispatched
      ? new Prisma.Decimal(0)
      : so.onlineShippingAmount;
    const already = await this.ordersRepository.sumCompletedRefunds(so.orderId);
    const cap = Prisma.Decimal.max(
      so.order.onlineAmount.sub(already),
      new Prisma.Decimal(0),
    );
    return Prisma.Decimal.min(merchRefund.add(freight), cap);
  }

  private isCaptured(so: CancelSubOrderRow): boolean {
    return (
      Boolean(so.order.razorpayPaymentId) &&
      (so.order.paymentStatus === PaymentStatus.PAID ||
        so.order.paymentStatus === PaymentStatus.PARTIALLY_PAID ||
        so.order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED)
    );
  }

  private remainingUndelivered(so: CancelSubOrderRow): {
    qty: number;
    merch: Prisma.Decimal;
  } {
    const deliveredByItem = new Map<string, number>();
    for (const delivery of so.deliveries) {
      if (delivery.status !== 'DELIVERED') {
        continue;
      }
      for (const line of delivery.items) {
        deliveredByItem.set(
          line.orderItemId,
          (deliveredByItem.get(line.orderItemId) ?? 0) + line.quantity,
        );
      }
    }
    let qty = 0;
    let merch = new Prisma.Decimal(0);
    for (const item of so.items) {
      const delivered = deliveredByItem.get(item.id) ?? 0;
      const remaining = item.quantity - item.cancelledQuantity - delivered;
      if (remaining <= 0) {
        continue;
      }
      qty += remaining;
      const unit =
        item.quantity > 0
          ? item.total.div(item.quantity)
          : new Prisma.Decimal(0);
      merch = merch.add(unit.mul(remaining));
    }
    return { qty, merch };
  }

  private computeOnlineRefund(so: CancelSubOrderRow): Prisma.Decimal {
    const remaining = this.remainingUndelivered(so);
    const merchNet = Prisma.Decimal.max(
      so.subtotal.sub(so.discountAmount),
      new Prisma.Decimal(0),
    );
    const deliveredQty = so.items.reduce((sum, item) => {
      const delivered = so.deliveries
        .filter((d) => d.status === 'DELIVERED')
        .reduce(
          (dSum, d) =>
            dSum +
            d.items
              .filter((line) => line.orderItemId === item.id)
              .reduce((l, line) => l + line.quantity, 0),
          0,
        );
      return sum + delivered;
    }, 0);

    let merchRefund: Prisma.Decimal;
    if (deliveredQty === 0) {
      merchRefund = so.onlineMerchandiseAmount;
    } else if (merchNet.greaterThan(0)) {
      merchRefund = roundMoney(
        remaining.merch.div(merchNet).mul(so.onlineMerchandiseAmount),
      );
    } else {
      merchRefund = new Prisma.Decimal(0);
    }

    const dispatched = so.deliveries.some((d) =>
      isDeliveryDispatched(d.status),
    );
    const freight = dispatched
      ? new Prisma.Decimal(0)
      : so.onlineShippingAmount;
    return merchRefund.add(freight);
  }
}
