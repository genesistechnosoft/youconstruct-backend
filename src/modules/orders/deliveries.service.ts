import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryStatus,
  NotificationEventType,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';
import { COMMERCE_OTP_PURPOSES } from '../../common/otp/commerce-otp.constants';
import { CommerceOtpService } from '../../common/otp/commerce-otp.service';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { formatMoney } from '../../common/utils/money.util';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
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

    const updated = await this.deliveriesRepository.transitionDelivery({
      deliveryId,
      fromStatus: delivery.status,
      toStatus: dto.status,
      actorUserId: userId,
      trackingNumber: dto.trackingNumber,
      courierName: dto.courierName,
      vendorRemarks: dto.vendorRemarks,
      customerRemarks: dto.customerRemarks,
    });

    if (dto.status === DeliveryStatus.OUT_FOR_DELIVERY) {
      await this.sendDeliveryOtp(deliveryId);
    }
    this.emitStatusNotifications(delivery.subOrder, dto.status, deliveryId);

    return {
      message: 'Delivery status updated',
      data: this.serialize(updated),
    };
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
    if (!dto.reason.trim()) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        'Override reason is required',
      );
    }

    const updated = await this.deliveriesRepository.transitionDelivery({
      deliveryId,
      fromStatus: delivery.status,
      toStatus: dto.status,
      actorUserId: adminUserId,
      trackingNumber: dto.trackingNumber,
      courierName: dto.courierName,
      vendorRemarks: dto.vendorRemarks,
      customerRemarks: dto.customerRemarks,
      overriddenByUserId: adminUserId,
      overrideReason: dto.reason,
    });

    this.emitStatusNotifications(delivery.subOrder, dto.status, deliveryId);

    return {
      message: 'Delivery status updated',
      data: this.serialize(updated),
    };
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
    if (
      status === SubOrderStatus.CANCELLED ||
      status === SubOrderStatus.REFUNDED ||
      status === SubOrderStatus.PENDING
    ) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
        'Deliveries can only be created for confirmed sub-orders',
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
  ) {
    if (status === DeliveryStatus.SHIPPED) {
      this.notifications.emit({
        userId: subOrder.order.userId,
        eventType: NotificationEventType.ORDER_SHIPPED,
        title: 'Order shipped',
        body: `Sub-order ${subOrder.subOrderNumber} has been shipped`,
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
        title: 'Order delivered',
        body: `Sub-order ${subOrder.subOrderNumber} has a confirmed delivery`,
        data: {
          orderId: subOrder.orderId,
          subOrderId: subOrder.id,
          deliveryId,
        },
      });
    }
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
