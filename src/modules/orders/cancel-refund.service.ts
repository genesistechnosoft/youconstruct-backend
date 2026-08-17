import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  NotificationEventType,
  OrderRefundStatus,
  PaymentMethod,
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
import { RazorpayClient } from '../payments/razorpay.client';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { isCancelAllowedBeforeCutoff } from './order-status.util';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

type CancelAudience = 'customer' | 'vendor' | 'admin' | 'system';

@Injectable()
export class CancelRefundService {
  private readonly logger = new Logger(CancelRefundService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
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
    } catch (error) {
      throw error;
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

    if (input.audience === 'customer' || input.audience === 'vendor') {
      const cutoffKey =
        input.audience === 'customer'
          ? 'customerCancelUntilStatus'
          : 'vendorCancelUntilStatus';
      const cutoff = await this.platformSettings.getString(
        'commerce',
        cutoffKey,
      );
      if (!isCancelAllowedBeforeCutoff(so.status, cutoff)) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.CANCEL_NOT_ALLOWED,
          `Cancellation is not allowed after ${cutoff}`,
        );
      }
    }

    const paidOnline =
      so.order.paymentMethod === PaymentMethod.ONLINE &&
      so.order.paymentStatus === PaymentStatus.PAID &&
      Boolean(so.order.razorpayPaymentId);

    if (paidOnline) {
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
      clawbackWallet: Boolean(so.walletCreditedAt),
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

    for (const target of refundable) {
      const so = await this.ordersRepository.findSubOrderForCancelRefund(
        target.id,
      );
      if (!so) {
        continue;
      }

      const paidOnline =
        so.order.paymentMethod === PaymentMethod.ONLINE &&
        so.order.paymentStatus === PaymentStatus.PAID &&
        Boolean(so.order.razorpayPaymentId);

      if (!paidOnline && so.order.paymentMethod === PaymentMethod.ONLINE) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
          'Online order is not paid — cancel instead of refund',
        );
      }

      if (paidOnline) {
        await this.refundSubOrderInternal({
          so,
          actorUserId: input.actorUserId,
          actorRole: PlatformRole.ADMIN,
          reason: input.note ?? 'Admin refund',
          fromCancel: false,
          audience: 'admin',
        });
      } else {
        await this.ordersRepository.applySubOrderCancelOrRefund({
          subOrderId: so.id,
          actorUserId: input.actorUserId,
          actorRole: PlatformRole.ADMIN,
          reason: input.note ?? 'Admin refund',
          targetStatus: SubOrderStatus.REFUNDED,
          restock: true,
          clawbackWallet: Boolean(so.walletCreditedAt),
          createRefund: true,
          refundAmount: so.total,
          refundStatus: OrderRefundStatus.COMPLETED,
        });

        this.notifications.emit({
          userId: so.order.userId,
          eventType: NotificationEventType.ORDER_REFUNDED,
          title: 'Order refunded',
          body: input.note ?? 'Your order has been refunded',
          data: { orderId: so.orderId, subOrderId: so.id },
        });
      }
    }

    const refreshed = await this.ordersRepository.findOrderById(input.orderId);
    return {
      message: 'Refund completed successfully',
      data: this.ordersService.serializeOrderForAudience(refreshed!, 'admin'),
    };
  }

  private async refundSubOrderInternal(input: {
    so: NonNullable<
      Awaited<ReturnType<OrdersRepository['findSubOrderForCancelRefund']>>
    >;
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
    } catch (error) {
      throw error;
    } finally {
      if (!input.fromCancel) {
        this.logger.log(
          `cancel_refund durationMs=${Date.now() - started} subOrderId=${input.so.id} ${ok ? 'ok' : 'fail'}`,
        );
      }
    }
  }

  private async executeRefundSubOrder(input: {
    so: NonNullable<
      Awaited<ReturnType<OrdersRepository['findSubOrderForCancelRefund']>>
    >;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    reason: string;
    fromCancel: boolean;
    audience: CancelAudience;
    vendorId?: string;
  }) {
    const existing = await this.ordersRepository.findCompletedRefundForSubOrder(
      input.so.id,
    );
    if (existing) {
      throw domainConflict(
        DOMAIN_ERROR_CODES.ALREADY_CANCELLED,
        'Sub-order already has a refund in progress or completed',
      );
    }

    const paymentId = input.so.order.razorpayPaymentId;
    if (!paymentId) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.REFUND_NOT_ALLOWED,
        'Missing Razorpay payment id for refund',
      );
    }

    const amountPaise = Number(input.so.total.mul(100).toFixed(0));
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
        amount: input.so.total,
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
      targetStatus: SubOrderStatus.REFUNDED,
      restock: true,
      clawbackWallet: Boolean(input.so.walletCreditedAt),
      createRefund: true,
      refundAmount: input.so.total,
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
}
