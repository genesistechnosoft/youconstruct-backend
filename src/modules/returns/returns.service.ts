import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  NotificationEventType,
  OrderRefundStatus,
  Prisma,
  ReturnStatus,
} from '../../../generated/prisma/client.js';
import { COMMERCE_OTP_PURPOSES } from '../../common/otp/commerce-otp.constants';
import { CommerceOtpService } from '../../common/otp/commerce-otp.service';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { formatMoney, toPaise } from '../../common/utils/money.util';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { RazorpayClient } from '../payments/razorpay.client';
import {
  AdminOverrideReturnDto,
  ConfirmOfflineRefundDto,
  ConfirmReturnReceiptDto,
  CreateReturnRequestDto,
  ReviewReturnDto,
} from './dto/return-request.dto';
import { ReturnsRepository } from './returns.repository';

type ReturnAudience = 'customer' | 'vendor' | 'admin';
type ReturnDetail = NonNullable<
  Awaited<ReturnType<ReturnsRepository['findById']>>
>;
type ReturnListRow = Awaited<
  ReturnType<ReturnsRepository['listForCustomer']>
>[number];

@Injectable()
export class ReturnsService {
  constructor(
    private readonly returnsRepository: ReturnsRepository,
    private readonly platformSettings: PlatformSettingsService,
    private readonly commerceOtp: CommerceOtpService,
    private readonly notifications: NotificationEmitterService,
    @Inject(forwardRef(() => RazorpayClient))
    private readonly razorpayClient: RazorpayClient,
  ) {}

  async listCustomer(userId: string) {
    const items = await this.returnsRepository.listForCustomer(userId);
    return {
      message: 'Returns fetched successfully',
      data: items.map((item) => this.serialize(item, 'customer', 'list')),
    };
  }

  async listVendor(vendorId: string) {
    const items = await this.returnsRepository.listForVendor(vendorId);
    return {
      message: 'Returns fetched successfully',
      data: items.map((item) => this.serialize(item, 'vendor', 'list')),
    };
  }

  async listAdmin() {
    const items = await this.returnsRepository.listForAdmin();
    return {
      message: 'Returns fetched successfully',
      data: items.map((item) => this.serialize(item, 'admin', 'list')),
    };
  }

  async getOne(id: string, scope?: { userId?: string; vendorId?: string }) {
    const request = await this.returnsRepository.findById(id);
    if (!request) {
      throw new NotFoundException('Return request not found');
    }
    if (scope?.userId && request.userId !== scope.userId) {
      throw new NotFoundException('Return request not found');
    }
    if (scope?.vendorId && request.vendorId !== scope.vendorId) {
      throw new NotFoundException('Return request not found');
    }
    const audience: ReturnAudience = scope?.userId
      ? 'customer'
      : scope?.vendorId
        ? 'vendor'
        : 'admin';
    return {
      message: 'Return request fetched successfully',
      data: this.serialize(request, audience, 'detail'),
    };
  }

  async createCustomer(
    userId: string,
    orderId: string,
    dto: CreateReturnRequestDto,
  ) {
    const enabled = await this.platformSettings.getBoolean(
      'commerce',
      'returnsEnabled',
    );
    if (!enabled) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.RETURNS_DISABLED,
        'Returns are currently disabled',
      );
    }

    const delivery = await this.returnsRepository.findDeliveryForReturn(
      dto.deliveryId,
    );
    if (!delivery || delivery.subOrder.order.id !== orderId) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.subOrder.order.userId !== userId) {
      throw new NotFoundException('Delivery not found');
    }
    if (
      !this.returnsRepository.requireDelivered(delivery.status) ||
      !delivery.deliveredAt
    ) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.RETURN_WINDOW_EXPIRED,
        'Only delivered items can be returned',
      );
    }

    const windowHours = await this.platformSettings.getNumber(
      'commerce',
      'returnWindowHours',
    );
    const deadline = new Date(
      delivery.deliveredAt.getTime() +
        (windowHours > 0 ? windowHours : 48) * 60 * 60 * 1000,
    );
    if (Date.now() > deadline.getTime()) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.RETURN_WINDOW_EXPIRED,
        'The return window for this delivery has expired',
      );
    }

    const already = this.returnsRepository.returnedQtyByDeliveryItem(
      delivery.returnRequests,
    );
    const itemsById = new Map(delivery.items.map((item) => [item.id, item]));
    const items = dto.items.map((line) => {
      const deliveryItem = itemsById.get(line.deliveryItemId);
      if (!deliveryItem) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
          'Delivery item does not belong to this delivery',
        );
      }
      const used = already.get(line.deliveryItemId) ?? 0;
      if (line.quantity > deliveryItem.quantity - used) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.DELIVERY_QTY_INVALID,
          'Return quantity exceeds delivered quantity',
        );
      }
      return {
        orderItemId: deliveryItem.orderItemId,
        deliveryItemId: line.deliveryItemId,
        quantity: line.quantity,
      };
    });

    const created = await this.returnsRepository.createRequest({
      orderId,
      subOrderId: delivery.subOrderId,
      deliveryId: delivery.id,
      userId,
      vendorId: delivery.subOrder.vendorId,
      reasonCode: dto.reasonCode,
      details: dto.details,
      items,
      mediaIds: dto.mediaIds,
    });

    const loaded = await this.returnsRepository.findById(created.id);
    if (!loaded) {
      throw new NotFoundException('Return request not found');
    }

    this.notifications.emit({
      userId,
      eventType: NotificationEventType.RETURN_REQUESTED,
      title: 'Return requested',
      body: 'Your return request was submitted',
      data: { returnRequestId: created.id, orderId },
    });

    return {
      message: 'Return request created',
      data: this.serialize(loaded, 'customer', 'detail'),
    };
  }

  async approveVendor(
    vendorId: string,
    id: string,
    userId: string,
    dto: ReviewReturnDto,
  ) {
    const request = await this.requireVendor(vendorId, id);
    this.assertStatus(request.status, [ReturnStatus.REQUESTED]);
    const updated = await this.returnsRepository.updateStatus({
      id,
      from: [ReturnStatus.REQUESTED],
      status: ReturnStatus.APPROVED,
      vendorReviewNote: dto.note,
      reviewedByUserId: userId,
    });
    this.notifications.emit({
      userId: request.userId,
      eventType: NotificationEventType.RETURN_APPROVED,
      title: 'Return approved',
      body: 'Your return request was approved',
      data: { returnRequestId: id },
    });
    return {
      message: 'Return approved',
      data: this.serialize(updated, 'vendor', 'detail'),
    };
  }

  async rejectVendor(
    vendorId: string,
    id: string,
    userId: string,
    dto: ReviewReturnDto,
  ) {
    const request = await this.requireVendor(vendorId, id);
    this.assertStatus(request.status, [ReturnStatus.REQUESTED]);
    const updated = await this.returnsRepository.updateStatus({
      id,
      from: [ReturnStatus.REQUESTED],
      status: ReturnStatus.REJECTED,
      vendorReviewNote: dto.note,
      reviewedByUserId: userId,
    });
    this.notifications.emit({
      userId: request.userId,
      eventType: NotificationEventType.RETURN_REJECTED,
      title: 'Return rejected',
      body: dto.note ?? 'Your return request was rejected',
      data: { returnRequestId: id },
    });
    return {
      message: 'Return rejected',
      data: this.serialize(updated, 'vendor', 'detail'),
    };
  }

  async adminOverride(
    id: string,
    adminUserId: string,
    dto: AdminOverrideReturnDto,
    status: ReturnStatus,
  ) {
    const request = await this.returnsRepository.findById(id);
    if (!request) {
      throw new NotFoundException('Return request not found');
    }
    const updated = await this.returnsRepository.updateStatus({
      id,
      from: [
        ReturnStatus.REQUESTED,
        ReturnStatus.APPROVED,
        ReturnStatus.REJECTED,
      ],
      status,
      adminOverrideReason: dto.reason,
      reviewedByUserId: adminUserId,
    });
    this.notifications.emit({
      userId: request.userId,
      eventType:
        status === ReturnStatus.REJECTED
          ? NotificationEventType.RETURN_REJECTED
          : NotificationEventType.RETURN_APPROVED,
      title:
        status === ReturnStatus.REJECTED
          ? 'Return rejected'
          : 'Return approved',
      body: dto.reason,
      data: { returnRequestId: id },
    });
    return {
      message: 'Return updated',
      data: this.serialize(updated, 'admin', 'detail'),
    };
  }

  async sendReceiptOtp(vendorId: string, id: string) {
    const request = await this.requireVendor(vendorId, id);
    this.assertStatus(request.status, [ReturnStatus.APPROVED]);
    return this.sendOtp(
      request,
      COMMERCE_OTP_PURPOSES.RETURN_RECEIPT,
      'Your YouConstruct return receipt OTP is {otp}.',
    );
  }

  async confirmReceipt(
    id: string,
    actorUserId: string,
    dto: ConfirmReturnReceiptDto,
    options: { vendorId?: string; admin?: boolean },
  ) {
    const request = options.vendorId
      ? await this.requireVendor(options.vendorId, id)
      : await this.requireExisting(id);
    this.assertStatus(request.status, [ReturnStatus.APPROVED]);

    if (options.admin) {
      if (!dto.reason?.trim()) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.OTP_INVALID,
          'Override reason is required',
        );
      }
    } else {
      await this.verifyOtp(id, COMMERCE_OTP_PURPOSES.RETURN_RECEIPT, dto.otp);
    }

    const amounts = this.computeRefundAmounts(request);
    const restock = this.restockLines(request);
    await this.returnsRepository.restockAndClawback({
      returnId: id,
      vendorId: request.vendorId,
      restock,
      walletClawback: amounts.walletClawback,
    });

    const updated = await this.returnsRepository.updateStatus({
      id,
      from: [ReturnStatus.APPROVED],
      status: ReturnStatus.RECEIVED,
      receivedAt: new Date(),
      inspectionNotes: dto.inspectionNotes,
      onlineRefundAmount: amounts.online,
      offlineRefundAmount: amounts.offline,
      adminOverrideReason: options.admin ? dto.reason : undefined,
      reviewedByUserId: actorUserId,
    });

    await this.attemptOnlineRefund(updated!, actorUserId);

    this.notifications.emit({
      userId: request.userId,
      eventType: NotificationEventType.RETURN_RECEIVED,
      title: 'Return received',
      body: 'Returned items were received',
      data: { returnRequestId: id },
    });

    const audience: ReturnAudience = options.admin ? 'admin' : 'vendor';
    return {
      message: 'Return received',
      data: this.serialize(
        await this.returnsRepository.findById(id),
        audience,
        'detail',
      ),
    };
  }

  async retryOnlineRefund(
    id: string,
    actorUserId: string,
    audience: Extract<ReturnAudience, 'vendor' | 'admin'>,
  ) {
    const request = await this.requireExisting(id);
    this.assertStatus(request.status, [
      ReturnStatus.RECEIVED,
      ReturnStatus.COMPLETED,
    ]);
    await this.attemptOnlineRefund(request, actorUserId);
    return {
      message: 'Online refund attempted',
      data: this.serialize(
        await this.returnsRepository.findById(id),
        audience,
        'detail',
      ),
    };
  }

  async sendOfflineRefundOtp(vendorId: string, id: string) {
    const request = await this.requireVendor(vendorId, id);
    this.assertStatus(request.status, [
      ReturnStatus.RECEIVED,
      ReturnStatus.COMPLETED,
    ]);
    return this.sendOtp(
      request,
      COMMERCE_OTP_PURPOSES.OFFLINE_REFUND_CONFIRMATION,
      'Your YouConstruct cash refund OTP is {otp}.',
    );
  }

  async confirmOfflineRefund(
    id: string,
    actorUserId: string,
    dto: ConfirmOfflineRefundDto,
    options: { vendorId?: string; admin?: boolean },
  ) {
    const request = options.vendorId
      ? await this.requireVendor(options.vendorId, id)
      : await this.requireExisting(id);
    const audience: ReturnAudience = options.admin ? 'admin' : 'vendor';
    if (request.offlineRefundConfirmedAt) {
      return {
        message: 'Offline refund already confirmed',
        data: this.serialize(request, audience, 'detail'),
      };
    }
    if (options.admin) {
      if (!dto.reason?.trim()) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.OTP_INVALID,
          'Override reason is required',
        );
      }
    } else {
      await this.verifyOtp(
        id,
        COMMERCE_OTP_PURPOSES.OFFLINE_REFUND_CONFIRMATION,
        dto.otp,
      );
    }

    const amounts = this.computeRefundAmounts(request);
    const onlineDone = request.refunds.some(
      (refund) => refund.status === OrderRefundStatus.COMPLETED,
    );
    const nextStatus =
      amounts.online.lessThanOrEqualTo(0) || onlineDone
        ? ReturnStatus.COMPLETED
        : ReturnStatus.RECEIVED;

    const updated = await this.returnsRepository.updateStatus({
      id,
      from: [ReturnStatus.RECEIVED, ReturnStatus.COMPLETED],
      status: nextStatus,
      offlineRefundConfirmedAt: new Date(),
      offlineRefundAmount: amounts.offline,
      adminOverrideReason: options.admin ? dto.reason : undefined,
      reviewedByUserId: actorUserId,
    });

    this.notifications.emit({
      userId: request.userId,
      eventType: NotificationEventType.RETURN_REFUNDED,
      title: 'Return refunded',
      body: 'Cash refund for your return was recorded',
      data: { returnRequestId: id },
    });

    return {
      message: 'Offline refund confirmed',
      data: this.serialize(updated, audience, 'detail'),
    };
  }

  private async attemptOnlineRefund(
    request: NonNullable<Awaited<ReturnType<ReturnsRepository['findById']>>>,
    actorUserId: string,
  ) {
    const amounts = this.computeRefundAmounts(request);
    if (amounts.online.lessThanOrEqualTo(0)) {
      if (
        request.offlineRefundConfirmedAt ||
        amounts.offline.lessThanOrEqualTo(0)
      ) {
        await this.returnsRepository.updateStatus({
          id: request.id,
          from: [ReturnStatus.RECEIVED],
          status: ReturnStatus.COMPLETED,
        });
      }
      return;
    }
    if (
      request.refunds.some(
        (refund) =>
          refund.status === OrderRefundStatus.COMPLETED ||
          refund.status === OrderRefundStatus.PROCESSING,
      )
    ) {
      return;
    }

    const already = await this.returnsRepository.sumCompletedRefunds(
      request.orderId,
    );
    const remainingCap = Prisma.Decimal.max(
      request.order.onlineAmount.sub(already._sum.amount ?? 0),
      new Prisma.Decimal(0),
    );
    const amount = Prisma.Decimal.min(amounts.online, remainingCap);
    if (amount.lessThanOrEqualTo(0) || !request.order.razorpayPaymentId) {
      return;
    }

    try {
      const refund = await this.razorpayClient.createRefund({
        paymentId: request.order.razorpayPaymentId,
        amountPaise: toPaise(amount),
        notes: { returnRequestId: request.id, orderId: request.orderId },
      });
      await this.returnsRepository.createOnlineRefund({
        orderId: request.orderId,
        subOrderId: request.subOrderId,
        returnRequestId: request.id,
        actorUserId,
        amount,
        razorpayRefundId: refund.id,
        providerPayload: refund.payload as Prisma.InputJsonValue,
        status: OrderRefundStatus.COMPLETED,
        reason: 'Return online refund',
      });
      if (
        request.offlineRefundConfirmedAt ||
        amounts.offline.lessThanOrEqualTo(0)
      ) {
        await this.returnsRepository.updateStatus({
          id: request.id,
          from: [ReturnStatus.RECEIVED],
          status: ReturnStatus.COMPLETED,
          onlineRefundAmount: amount,
        });
      }
      this.notifications.emit({
        userId: request.userId,
        eventType: NotificationEventType.RETURN_REFUNDED,
        title: 'Return refunded',
        body: 'Online refund for your return was issued',
        data: { returnRequestId: request.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refund failed';
      await this.returnsRepository.createOnlineRefund({
        orderId: request.orderId,
        subOrderId: request.subOrderId,
        returnRequestId: request.id,
        actorUserId,
        amount,
        razorpayRefundId: null,
        status: OrderRefundStatus.FAILED,
        reason: message,
      });
    }
  }

  private computeRefundAmounts(
    request: NonNullable<Awaited<ReturnType<ReturnsRepository['findById']>>>,
  ) {
    const deliveryQty = request.delivery.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const returnQty = request.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const share =
      deliveryQty > 0
        ? new Prisma.Decimal(returnQty).div(deliveryQty)
        : new Prisma.Decimal(0);

    const merchNet = Prisma.Decimal.max(
      request.subOrder.subtotal.sub(request.subOrder.discountAmount),
      new Prisma.Decimal(0),
    );
    const unitNet = new Map(
      request.subOrder.items.map((item) => [
        item.id,
        item.quantity > 0
          ? item.total.div(item.quantity)
          : new Prisma.Decimal(0),
      ]),
    );
    const sliceMerch = request.items.reduce((sum, item) => {
      const unit = unitNet.get(item.orderItemId) ?? new Prisma.Decimal(0);
      return sum.add(unit.mul(item.quantity));
    }, new Prisma.Decimal(0));

    const online = merchNet.greaterThan(0)
      ? this.returnsRepository.roundShare(
          sliceMerch,
          merchNet,
          request.subOrder.onlineMerchandiseAmount,
        )
      : new Prisma.Decimal(0);
    const offline = merchNet.greaterThan(0)
      ? this.returnsRepository.roundShare(
          sliceMerch,
          merchNet,
          request.subOrder.offlineMerchandiseAmount,
        )
      : new Prisma.Decimal(0);
    const walletClawback = request.delivery.walletCreditAmount.mul(share);

    return {
      online,
      offline,
      walletClawback: walletClawback.toDecimalPlaces(
        2,
        Prisma.Decimal.ROUND_HALF_UP,
      ),
    };
  }

  private restockLines(
    request: NonNullable<Awaited<ReturnType<ReturnsRepository['findById']>>>,
  ) {
    const variantByItem = new Map(
      request.subOrder.items.map((item) => [item.id, item.variantId]),
    );
    const byVariant = new Map<string, number>();
    for (const item of request.items) {
      const variantId = variantByItem.get(item.orderItemId);
      if (!variantId) {
        continue;
      }
      byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + item.quantity);
    }
    return [...byVariant.entries()].map(([variantId, quantity]) => ({
      variantId,
      quantity,
    }));
  }

  private async sendOtp(
    request: NonNullable<Awaited<ReturnType<ReturnsRepository['findById']>>>,
    purpose: (typeof COMMERCE_OTP_PURPOSES)[keyof typeof COMMERCE_OTP_PURPOSES],
    body: string,
  ) {
    const phone = request.order.addressPhone ?? request.user.phone;
    if (!phone) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.OTP_PHONE_MISSING,
        'No phone number is available to send the OTP',
      );
    }
    const ttlMinutes = await this.platformSettings.getNumber(
      'commerce',
      'deliveryOtpTtlMinutes',
    );
    return this.commerceOtp.send({
      phone,
      purpose,
      referenceType: 'RETURN',
      referenceId: request.id,
      userId: request.userId,
      ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 10,
      body,
    });
  }

  private async verifyOtp(
    returnId: string,
    purpose: (typeof COMMERCE_OTP_PURPOSES)[keyof typeof COMMERCE_OTP_PURPOSES],
    otp?: string,
  ) {
    if (!otp) {
      throw domainBadRequest(DOMAIN_ERROR_CODES.OTP_INVALID, 'OTP is required');
    }
    const maxAttempts = await this.platformSettings.getNumber(
      'commerce',
      'deliveryOtpMaxAttempts',
    );
    await this.commerceOtp.verify({
      otp,
      purpose,
      referenceType: 'RETURN',
      referenceId: returnId,
      maxAttempts: maxAttempts > 0 ? maxAttempts : 5,
    });
  }

  private async requireVendor(vendorId: string, id: string) {
    const request = await this.returnsRepository.findById(id);
    if (!request || request.vendorId !== vendorId) {
      throw new NotFoundException('Return request not found');
    }
    return request;
  }

  private async requireExisting(id: string) {
    const request = await this.returnsRepository.findById(id);
    if (!request) {
      throw new NotFoundException('Return request not found');
    }
    return request;
  }

  private assertStatus(current: ReturnStatus, allowed: ReturnStatus[]) {
    if (!allowed.includes(current)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Return cannot be updated from ${current}`,
      );
    }
  }

  private serialize(
    request: ReturnDetail | ReturnListRow | null,
    audience: ReturnAudience,
    mode: 'list' | 'detail',
  ) {
    if (!request) {
      return null;
    }

    const payload: Record<string, unknown> = {
      id: request.id,
      orderId: request.orderId,
      subOrderId: request.subOrderId,
      deliveryId: request.deliveryId,
      userId: request.userId,
      vendorId: request.vendorId,
      status: request.status,
      reasonCode: request.reasonCode,
      details: request.details,
      vendorReviewNote: request.vendorReviewNote,
      adminOverrideReason: request.adminOverrideReason,
      reviewedByUserId: request.reviewedByUserId,
      receivedAt: request.receivedAt,
      inspectionNotes: request.inspectionNotes,
      onlineRefundAmount: formatMoney(request.onlineRefundAmount),
      offlineRefundAmount: formatMoney(request.offlineRefundAmount),
      offlineRefundConfirmedAt: request.offlineRefundConfirmedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      items: this.serializeItems(request.items),
      order: this.serializeOrderCard(request, audience, mode),
      subOrder: this.serializeSubOrderCard(request, audience, mode),
    };

    if (audience === 'customer' || audience === 'admin') {
      payload.vendor = this.serializeVendorCard(request.vendor, mode);
    }
    if (audience === 'vendor' || audience === 'admin') {
      payload.customer = this.serializeCustomerCard(request.user, mode);
    }

    if (mode === 'detail' && this.isDetail(request)) {
      payload.delivery = this.serializeDeliveryCard(request, audience);
      payload.refunds = this.serializeRefunds(request, audience);
      const flags = this.refundStepFlags(request);
      payload.needsOfflineRefund = flags.needsOfflineRefund;
      payload.needsOnlineRefund = flags.needsOnlineRefund;
    }

    return payload;
  }

  private isDetail(
    request: ReturnDetail | ReturnListRow,
  ): request is ReturnDetail {
    return 'delivery' in request && 'refunds' in request;
  }

  private serializeItems(items: ReturnListRow['items']) {
    return items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      deliveryItemId: item.deliveryItemId,
      variantId: item.orderItem.variantId,
      quantity: item.quantity,
      productName: item.orderItem.productName,
      variantName: item.orderItem.variantName,
      sku: item.orderItem.sku,
      unitSymbol: item.orderItem.unitSymbol,
      unitPrice: formatMoney(item.orderItem.unitPrice),
      imageUrlSnapshot: item.orderItem.imageUrlSnapshot,
    }));
  }

  private serializeOrderCard(
    request: ReturnDetail | ReturnListRow,
    audience: ReturnAudience,
    mode: 'list' | 'detail',
  ) {
    const order = request.order;
    const card: Record<string, unknown> = {
      id: order.id,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
    };
    if (mode !== 'detail' || !this.isDetail(request)) {
      return card;
    }
    card.fulfillmentStage = request.order.fulfillmentStage;
    card.fulfillmentSummary = request.order.fulfillmentSummary;
    card.paymentStatus = request.order.paymentStatus;
    if (audience !== 'customer') {
      card.razorpayPaymentId = request.order.razorpayPaymentId;
      card.addressLabel = request.order.addressLabel;
      card.addressLine1 = request.order.addressLine1;
      card.addressLine2 = request.order.addressLine2;
      card.addressCity = request.order.addressCity;
      card.addressState = request.order.addressState;
      card.addressPincode = request.order.addressPincode;
      card.addressPhone = request.order.addressPhone;
      card.addressLatitude = request.order.addressLatitude;
      card.addressLongitude = request.order.addressLongitude;
    }
    return card;
  }

  private serializeSubOrderCard(
    request: ReturnDetail | ReturnListRow,
    audience: ReturnAudience,
    mode: 'list' | 'detail',
  ) {
    const card: Record<string, unknown> = {
      id: request.subOrder.id,
      subOrderNumber: request.subOrder.subOrderNumber,
    };
    if (
      mode !== 'detail' ||
      !this.isDetail(request) ||
      audience === 'customer'
    ) {
      return card;
    }
    card.onlineMerchandiseAmount = formatMoney(
      request.subOrder.onlineMerchandiseAmount,
    );
    card.offlineMerchandiseAmount = formatMoney(
      request.subOrder.offlineMerchandiseAmount,
    );
    card.onlineShippingAmount = formatMoney(
      request.subOrder.onlineShippingAmount,
    );
    card.platformCommission = formatMoney(request.subOrder.platformCommission);
    card.vendorEarning = formatMoney(request.subOrder.vendorEarning);
    return card;
  }

  private serializeVendorCard(
    vendor: ReturnListRow['vendor'],
    mode: 'list' | 'detail',
  ) {
    const card: { id: string; businessName: string; slug?: string | null } = {
      id: vendor.id,
      businessName: vendor.businessName,
    };
    if (mode === 'detail') {
      card.slug = vendor.slug;
    }
    return card;
  }

  private serializeCustomerCard(
    user: ReturnListRow['user'],
    mode: 'list' | 'detail',
  ) {
    const card: {
      id: string;
      name: string;
      phone: string | null;
      avatarUrl: string | null;
      email?: string | null;
    } = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
    };
    if (mode === 'detail') {
      card.email = user.email;
    }
    return card;
  }

  private serializeDeliveryCard(
    request: ReturnDetail,
    audience: ReturnAudience,
  ) {
    const delivery: Record<string, unknown> = {
      id: request.delivery.id,
      deliveryNumber: request.delivery.deliveryNumber,
      status: request.delivery.status,
      deliveredAt: request.delivery.deliveredAt,
    };
    if (audience !== 'customer') {
      delivery.offlineAmountCollected = formatMoney(
        request.delivery.offlineAmountCollected,
      );
      delivery.walletCreditAmount = formatMoney(
        request.delivery.walletCreditAmount,
      );
      delivery.walletCreditedAt = request.delivery.walletCreditedAt;
    }
    return delivery;
  }

  private serializeRefunds(request: ReturnDetail, audience: ReturnAudience) {
    return request.refunds.map((refund) => {
      const row: Record<string, unknown> = {
        id: refund.id,
        amount: formatMoney(refund.amount),
        status: refund.status,
      };
      if (audience !== 'customer') {
        row.razorpayRefundId = refund.razorpayRefundId;
      }
      return row;
    });
  }

  private refundStepFlags(request: ReturnDetail) {
    const received =
      request.status === ReturnStatus.RECEIVED ||
      request.status === ReturnStatus.COMPLETED ||
      request.receivedAt != null;
    const offline = received
      ? request.offlineRefundAmount
      : request.subOrder.offlineMerchandiseAmount;
    const online = received
      ? request.onlineRefundAmount
      : request.subOrder.onlineMerchandiseAmount;
    const onlineDone = request.refunds.some(
      (refund) =>
        refund.status === OrderRefundStatus.COMPLETED ||
        refund.status === OrderRefundStatus.PROCESSING,
    );
    return {
      needsOfflineRefund:
        offline.greaterThan(0) && request.offlineRefundConfirmedAt == null,
      needsOnlineRefund: online.greaterThan(0) && !onlineDone,
    };
  }
}
