import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryCancelResolution,
  DeliveryStatus,
  NotificationEventType,
  PlatformRole,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';
import { COMMERCE_OTP_PURPOSES } from '../../common/otp/commerce-otp.constants';
import { CommerceOtpService } from '../../common/otp/commerce-otp.service';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { formatMoney } from '../../common/utils/money.util';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  CancelRefundService,
  type DeliveryRefundCapture,
} from './cancel-refund.service';
import { DeliveriesRepository } from './deliveries.repository';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import {
  AdminUpdateDeliveryStatusDto,
  DeliveryRemarksDto,
  UpdateDeliveryStatusDto,
} from './dto/update-delivery-status.dto';
import {
  isAdminDeliveryTransitionAllowed,
  isVendorDeliveryTransitionAllowed,
} from './order-status.util';

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly deliveriesRepository: DeliveriesRepository,
    private readonly cancelRefundService: CancelRefundService,
    private readonly commerceOtp: CommerceOtpService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
  ) {}

  async listVendor(vendorId: string, subOrderId: string) {
    const so = await this.deliveriesRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );
    if (!so) {
      throw new NotFoundException('Sub-order not found');
    }
    const deliveries =
      await this.deliveriesRepository.listForSubOrder(subOrderId);
    return {
      message: 'Deliveries fetched successfully',
      data: deliveries.map((d) => this.serialize(d)),
    };
  }

  async createVendor(
    vendorId: string,
    subOrderId: string,
    userId: string,
    dto: CreateDeliveryDto,
  ) {
    const so = await this.requireVendorSubOrder(vendorId, subOrderId);
    this.assertSubOrderOpen(so.status);
    this.assertUniqueItems(dto.items);

    const remaining = this.deliveriesRepository.remainingQtyByItem(
      so.items,
      so.deliveries,
    );
    for (const line of dto.items) {
      if (!remaining.has(line.orderItemId)) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
          'Order item does not belong to this sub-order',
        );
      }
      if (line.quantity > (remaining.get(line.orderItemId) ?? 0)) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
          'Delivery quantity exceeds remaining quantity',
        );
      }
    }

    const delivery = await this.deliveriesRepository.createDraft({
      subOrderId,
      deliveryNumber: this.buildDeliveryNumber(),
      actorUserId: userId,
      items: dto.items,
    });

    return {
      message: 'Delivery draft created',
      data: this.serialize(delivery),
    };
  }

  async updateVendorStatus(
    vendorId: string,
    subOrderId: string,
    deliveryId: string,
    userId: string,
    dto: UpdateDeliveryStatusDto,
  ) {
    const delivery = await this.requireVendorDelivery(
      vendorId,
      subOrderId,
      deliveryId,
    );
    if (!isVendorDeliveryTransitionAllowed(delivery.status, dto.status)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot transition delivery from ${delivery.status} to ${dto.status}`,
      );
    }

    if (dto.status === DeliveryStatus.DELIVERED) {
      if (!dto.vendorRemarks?.trim()) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
          'Vendor remarks are required at delivery',
        );
      }
      await this.verifyDeliveryOtp(deliveryId, dto.otp);
    }

    return this.changeStatus({
      delivery,
      deliveryId,
      actorUserId: userId,
      actorRole: PlatformRole.VENDOR,
      dto,
    });
  }

  async resendVendorOtp(
    vendorId: string,
    subOrderId: string,
    deliveryId: string,
  ) {
    const delivery = await this.requireVendorDelivery(
      vendorId,
      subOrderId,
      deliveryId,
    );
    if (delivery.status !== DeliveryStatus.OUT_FOR_DELIVERY) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        'OTP can only be sent for out-for-delivery shipments',
      );
    }
    return this.sendDeliveryOtp(deliveryId);
  }

  async updateCustomerRemarks(
    userId: string,
    orderId: string,
    deliveryId: string,
    dto: DeliveryRemarksDto,
  ) {
    const delivery = await this.deliveriesRepository.findById(deliveryId);
    if (!delivery || delivery.subOrder.order.id !== orderId) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.subOrder.order.userId !== userId) {
      throw new NotFoundException('Delivery not found');
    }
    const updated = await this.deliveriesRepository.updateCustomerRemarks(
      deliveryId,
      dto.customerRemarks?.trim() ?? '',
    );
    return {
      message: 'Delivery remarks updated',
      data: this.serialize(updated),
    };
  }

  async updateAdminStatus(
    deliveryId: string,
    adminUserId: string,
    dto: AdminUpdateDeliveryStatusDto,
  ) {
    const delivery = await this.deliveriesRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (!isAdminDeliveryTransitionAllowed(delivery.status, dto.status)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot transition delivery from ${delivery.status} to ${dto.status}`,
      );
    }
    if (!dto.reason?.trim()) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        'Override reason is required',
      );
    }

    return this.changeStatus({
      delivery,
      deliveryId,
      actorUserId: adminUserId,
      actorRole: PlatformRole.ADMIN,
      dto,
      override: true,
    });
  }

  private async changeStatus(input: {
    delivery: {
      status: DeliveryStatus;
      deliveryNumber: string;
      subOrder: {
        order: { userId: string };
        orderId: string;
        id?: string;
        subOrderNumber: string;
      };
    };
    deliveryId: string;
    actorUserId: string;
    actorRole: PlatformRole;
    dto: UpdateDeliveryStatusDto;
    override?: boolean;
  }) {
    const reason = input.dto.reason?.trim() ?? '';
    if (input.dto.status === DeliveryStatus.CANCELLED) {
      if (!input.dto.resolution) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
          'Choose whether to ship this box again or refund the customer',
        );
      }
      if (!reason) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
          'A reason is required to cancel a delivery',
        );
      }
    }

    const refund =
      input.dto.status === DeliveryStatus.CANCELLED &&
      input.dto.resolution === DeliveryCancelResolution.REFUND
        ? await this.cancelRefundService.captureDeliveryRefund({
            deliveryId: input.deliveryId,
            actorUserId: input.actorUserId,
            reason,
          })
        : undefined;

    const updated = await this.deliveriesRepository.transitionDelivery({
      deliveryId: input.deliveryId,
      fromStatus: input.delivery.status,
      toStatus: input.dto.status,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      trackingNumber: input.dto.trackingNumber,
      courierName: input.dto.courierName,
      vendorRemarks:
        input.actorRole === PlatformRole.VENDOR &&
        input.dto.status === DeliveryStatus.CANCELLED
          ? reason
          : input.dto.vendorRemarks,
      customerRemarks: input.dto.customerRemarks,
      ...(input.override
        ? {
            overriddenByUserId: input.actorUserId,
            overrideReason: reason,
          }
        : {}),
      resolution: input.dto.resolution,
      reason,
      refund,
    });

    if (input.dto.status === DeliveryStatus.OUT_FOR_DELIVERY) {
      await this.sendDeliveryOtp(input.deliveryId);
    }
    if (input.dto.status === DeliveryStatus.CANCELLED && input.dto.resolution) {
      this.emitCancellationNotification(
        input.delivery.subOrder,
        input.deliveryId,
        input.delivery.deliveryNumber,
        input.dto.resolution,
        refund,
      );
    } else {
      this.emitStatusNotifications(
        input.delivery.subOrder,
        input.dto.status,
        input.deliveryId,
        input.delivery.deliveryNumber,
      );
    }

    return {
      message: this.cancellationMessage(
        input.dto.status,
        input.dto.resolution,
        input.delivery.deliveryNumber,
        refund,
      ),
      data: this.serialize(updated),
    };
  }

  private cancellationMessage(
    status: DeliveryStatus,
    resolution: DeliveryCancelResolution | undefined,
    deliveryNumber: string,
    refund?: DeliveryRefundCapture,
  ) {
    if (status !== DeliveryStatus.CANCELLED) {
      return 'Delivery status updated';
    }
    if (resolution === DeliveryCancelResolution.REATTEMPT) {
      return `${deliveryNumber} was cancelled and will be shipped again`;
    }
    if (refund?.createRefund) {
      return `Refunded ₹${formatMoney(refund.refundAmount)} for ${deliveryNumber}`;
    }
    return `${deliveryNumber} was cancelled`;
  }

  private async sendDeliveryOtp(deliveryId: string) {
    const delivery = await this.deliveriesRepository.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    const phone =
      delivery.subOrder.order.addressPhone ??
      delivery.subOrder.order.user.phone;
    if (!phone) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.OTP_PHONE_MISSING,
        'No phone number is available to send the delivery OTP',
      );
    }
    const ttlMinutes = await this.platformSettings.getNumber(
      'commerce',
      'deliveryOtpTtlMinutes',
    );
    return this.commerceOtp.send({
      phone,
      purpose: COMMERCE_OTP_PURPOSES.DELIVERY_CONFIRMATION,
      referenceType: 'DELIVERY',
      referenceId: deliveryId,
      userId: delivery.subOrder.order.userId,
      ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 10,
      body: 'Your YouConstruct delivery OTP is {otp}. Do not share it.',
    });
  }

  private async verifyDeliveryOtp(deliveryId: string, otp?: string) {
    if (!otp) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.OTP_INVALID,
        'OTP is required to confirm delivery',
      );
    }
    const maxAttempts = await this.platformSettings.getNumber(
      'commerce',
      'deliveryOtpMaxAttempts',
    );
    await this.commerceOtp.verify({
      otp,
      purpose: COMMERCE_OTP_PURPOSES.DELIVERY_CONFIRMATION,
      referenceType: 'DELIVERY',
      referenceId: deliveryId,
      maxAttempts: maxAttempts > 0 ? maxAttempts : 5,
    });
  }

  private async requireVendorSubOrder(vendorId: string, subOrderId: string) {
    const so = await this.deliveriesRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );
    if (!so) {
      throw new NotFoundException('Sub-order not found');
    }
    return so;
  }

  private async requireVendorDelivery(
    vendorId: string,
    subOrderId: string,
    deliveryId: string,
  ) {
    const delivery = await this.deliveriesRepository.findById(deliveryId);
    if (
      !delivery ||
      delivery.subOrderId !== subOrderId ||
      delivery.subOrder.vendorId !== vendorId
    ) {
      throw new NotFoundException('Delivery not found');
    }
    return delivery;
  }

  private assertSubOrderOpen(status: SubOrderStatus) {
    if (status !== SubOrderStatus.PROCESSING) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
        'Deliveries can only be created after packing has started',
      );
    }
  }

  private assertUniqueItems(items: Array<{ orderItemId: string }>) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.orderItemId)) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
          'Duplicate order items in delivery',
        );
      }
      seen.add(item.orderItemId);
    }
  }

  private emitStatusNotifications(
    subOrder: {
      order: { userId: string };
      orderId: string;
      id?: string;
      subOrderNumber: string;
    },
    status: DeliveryStatus,
    deliveryId: string,
    deliveryNumber: string,
  ) {
    if (status === DeliveryStatus.SHIPPED) {
      this.notifications.emit({
        userId: subOrder.order.userId,
        eventType: NotificationEventType.ORDER_SHIPPED,
        title: 'Shipment shipped',
        body: `${deliveryNumber} has shipped`,
        data: {
          orderId: subOrder.orderId,
          subOrderId: subOrder.id,
          deliveryId,
        },
      });
    }
    if (status === DeliveryStatus.DELIVERED) {
      this.notifications.emit({
        userId: subOrder.order.userId,
        eventType: NotificationEventType.ORDER_DELIVERED,
        title: 'Shipment delivered',
        body: `${deliveryNumber} was delivered`,
        data: {
          orderId: subOrder.orderId,
          subOrderId: subOrder.id,
          deliveryId,
        },
      });
    }
  }

  private emitCancellationNotification(
    subOrder: {
      order: { userId: string };
      orderId: string;
      id?: string;
    },
    deliveryId: string,
    deliveryNumber: string,
    resolution: DeliveryCancelResolution,
    refund?: DeliveryRefundCapture,
  ) {
    const refunded = Boolean(refund?.createRefund);
    const title =
      resolution === DeliveryCancelResolution.REATTEMPT
        ? 'Shipment will be sent again'
        : refunded
          ? 'Shipment refunded'
          : 'Shipment cancelled';
    const body =
      resolution === DeliveryCancelResolution.REATTEMPT
        ? `${deliveryNumber} was cancelled and will be shipped again`
        : refunded
          ? `${deliveryNumber} was cancelled. ₹${formatMoney(refund!.refundAmount)} was refunded`
          : `${deliveryNumber} was cancelled`;
    this.notifications.emit({
      userId: subOrder.order.userId,
      eventType: refunded
        ? NotificationEventType.ORDER_REFUNDED
        : NotificationEventType.ORDER_CANCELLED,
      title,
      body,
      data: {
        orderId: subOrder.orderId,
        subOrderId: subOrder.id,
        deliveryId,
      },
    });
  }

  private buildDeliveryNumber(): string {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const short = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `DL-${stamp}-${short}`;
  }

  private serialize(delivery: {
    offlineAmountDue?: { toFixed?: (n: number) => string } | string | null;
    offlineAmountCollected?:
      | { toFixed?: (n: number) => string }
      | string
      | null;
    walletCreditAmount?: { toFixed?: (n: number) => string } | string | null;
    [key: string]: unknown;
  }) {
    return {
      ...delivery,
      offlineAmountDue:
        delivery.offlineAmountDue != null
          ? formatMoney(delivery.offlineAmountDue as never)
          : undefined,
      offlineAmountCollected:
        delivery.offlineAmountCollected != null
          ? formatMoney(delivery.offlineAmountCollected as never)
          : undefined,
      walletCreditAmount:
        delivery.walletCreditAmount != null
          ? formatMoney(delivery.walletCreditAmount as never)
          : undefined,
    };
  }
}
