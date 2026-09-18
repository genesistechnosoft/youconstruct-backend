import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PlatformRole,
  Prisma,
  SubOrderStatus,
  NotificationEventType,
  MediaAccessLevel,
} from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import {
  formatMoney,
  formatRate,
  roundMoney,
  toPaise,
} from '../../common/utils/money.util';
import { PAYMENT_TIMEOUT_QUEUE } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CouponsService } from '../coupons/coupons.service';
import { RazorpayClient } from '../payments/razorpay.client';
import { CancelRefundService } from './cancel-refund.service';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { AdminUpdateOrderStatusDto } from './dto/admin-update-order-status.dto';
import { CheckoutDto } from './dto/checkout.dto';
import {
  ListOrdersQueryDto,
  ListSubOrdersQueryDto,
} from './dto/list-orders-query.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { UpdateSubOrderStatusDto } from './dto/update-sub-order-status.dto';
import {
  PAYMENT_TIMEOUT_JOB_PREFIX,
  PAYMENT_TIMEOUT_MS,
} from './order.constants';
import {
  isAdminTransitionAllowed,
  isVendorTransitionAllowed,
} from './order-status.util';
import { CategoriesService } from '../categories/categories.service';
import { OrdersRepository } from './orders.repository';
import {
  ShippingQuoteService,
  type VendorShippingQuoteInput,
} from './shipping-quote.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly shippingQuoteService: ShippingQuoteService,
    @Inject(forwardRef(() => RazorpayClient))
    private readonly razorpayClient: RazorpayClient,
    @InjectQueue(PAYMENT_TIMEOUT_QUEUE)
    private readonly paymentTimeoutQueue: Queue,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => CancelRefundService))
    private readonly cancelRefundService: CancelRefundService,
    private readonly couponsService: CouponsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const started = Date.now();
    let orderId: string | undefined;
    let ok = false;
    try {
      const result = await this.executeCheckout(userId, dto);
      orderId =
        result.data &&
        typeof result.data === 'object' &&
        'order' in result.data &&
        result.data.order &&
        typeof result.data.order === 'object' &&
        'id' in result.data.order
          ? String(result.data.order.id)
          : undefined;
      ok = true;
      return result;
    } finally {
      this.logger.log(
        `checkout durationMs=${Date.now() - started} orderId=${orderId ?? 'n/a'} paymentMethod=${dto.paymentMethod} ${ok ? 'ok' : 'fail'}`,
      );
    }
  }

  private async executeCheckout(userId: string, dto: CheckoutDto) {
    if (dto.paymentMethod === PaymentMethod.COD) {
      const codEnabled = await this.platformSettings.getBoolean(
        'commerce',
        'codEnabled',
      );
      if (!codEnabled) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.COD_DISABLED,
          'Cash on delivery is currently disabled',
        );
      }
    }

    const address = await this.ordersRepository.findAddressForUser(
      userId,
      dto.addressId,
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    const cart = await this.ordersRepository.findCartWithShippingData(userId);
    if (!cart) {
      throw domainBadRequest(DOMAIN_ERROR_CODES.CART_EMPTY, 'Cart is empty');
    }
    const [visibleCategoryIds, freight, advanceRate, userRecord] =
      await Promise.all([
        this.categoriesService.getVisibleCategoryIds(),
        this.shippingQuoteService.getFreightOptions(),
        this.platformSettings.getDecimal('commerce', 'codAdvanceRate'),
        this.ordersRepository.findUserPhone(userId),
      ]);
    this.ordersRepository.assertCheckoutCartValid(
      cart,
      new Set(visibleCategoryIds),
      { requireVendorShipping: freight.freightSource !== 'PLATFORM_FLAT' },
    );

    const otpPhone = address.phone ?? userRecord?.phone ?? null;
    if (!otpPhone) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.OTP_PHONE_MISSING,
        'A phone number on the address or account is required for checkout',
      );
    }

    const productIds = cart.items.map((i) => i.variant.product.id);
    const variantIds = cart.items.map((i) => i.variant.id);
    const imageMap = await this.ordersRepository.findPrimaryImageSnapshots(
      productIds,
      variantIds,
    );
    const resolvedImages = new Map<
      string,
      {
        imageUrlSnapshot: string | null;
        imageStorageKeySnapshot: string | null;
      }
    >();
    for (const [entityId, snap] of imageMap) {
      let url: string | null = null;
      if (snap.imageStorageKeySnapshot) {
        try {
          url = await this.storageService.getUrl(
            snap.imageStorageKeySnapshot,
            MediaAccessLevel.PUBLIC,
          );
        } catch {
          url = null;
        }
      }
      resolvedImages.set(entityId, {
        imageStorageKeySnapshot: snap.imageStorageKeySnapshot,
        imageUrlSnapshot: url,
      });
    }

    const vendorMap = new Map<string, VendorShippingQuoteInput>();
    const inventoryDecrements: Array<{ variantId: string; quantity: number }> =
      [];

    for (const item of cart.items) {
      const variant = item.variant;
      const product = variant.product;
      const vendor = product.vendor;
      inventoryDecrements.push({
        variantId: variant.id,
        quantity: item.quantity,
      });

      let group = vendorMap.get(vendor.id);
      if (!group) {
        group = {
          vendorId: vendor.id,
          vendorName: vendor.businessName,
          geo: { latitude: vendor.latitude, longitude: vendor.longitude },
          shippingMethod: vendor.shippingMethod?.isActive
            ? {
                methodType: vendor.shippingMethod.methodType,
                flatCharge: vendor.shippingMethod.flatCharge,
                isFree: vendor.shippingMethod.isFree,
                freeAboveOrderValue: vendor.shippingMethod.freeAboveOrderValue,
                freeWithinKm: vendor.shippingMethod.freeWithinKm,
                chargeBeyondKm: vendor.shippingMethod.chargeBeyondKm,
                unitCharge: vendor.shippingMethod.unitCharge,
                unitType: vendor.shippingMethod.unitType,
                orderValueTiers: vendor.shippingMethod.orderValueTiers,
              }
            : null,
          lines: [],
        };
        vendorMap.set(vendor.id, group);
      }

      group.lines.push({
        variantId: variant.id,
        productId: product.id,
        vendorId: vendor.id,
        quantity: item.quantity,
        sellingPrice: variant.sellingPrice,
        weightKg: variant.weightKg,
        coverageArea: variant.coverageArea,
        shippingOverride: product.shippingOverride
          ? {
              methodType: product.shippingOverride.methodType,
              flatCharge: product.shippingOverride.flatCharge,
              isFree: product.shippingOverride.isFree,
              freeAboveOrderValue: product.shippingOverride.freeAboveOrderValue,
              freeWithinKm: product.shippingOverride.freeWithinKm,
              chargeBeyondKm: product.shippingOverride.chargeBeyondKm,
              unitCharge: product.shippingOverride.unitCharge,
              unitType: product.shippingOverride.unitType,
            }
          : null,
      });
    }

    const quote = this.shippingQuoteService.computeQuote(
      [...vendorMap.values()],
      {
        latitude: address.latitude,
        longitude: address.longitude,
      },
      freight,
    );

    const orderStatus = OrderStatus.PENDING_PAYMENT;
    const paymentStatus = PaymentStatus.PENDING;
    const subOrderStatus = SubOrderStatus.PENDING;

    const dateStamp = this.formatDateStamp(new Date());
    let orderNumber = this.buildOrderNumber(dateStamp);

    const couponLines = cart.items.map((item) => ({
      variantId: item.variant.id,
      vendorId: item.variant.product.vendor.id,
      lineTotal: item.variant.sellingPrice.mul(item.quantity),
    }));

    let discountAmount = new Prisma.Decimal(0);
    let couponId: string | null = null;
    let discountByVariant = new Map<string, Prisma.Decimal>();
    if (dto.couponCode) {
      const evaluation = await this.couponsService.evaluateCoupon(
        dto.couponCode,
        userId,
        couponLines,
      );
      discountAmount = evaluation.discountAmount;
      couponId = evaluation.couponId;
      discountByVariant = this.couponsService.allocateDiscountToLines(
        couponLines,
        evaluation,
      );
    }

    const isCod = dto.paymentMethod === PaymentMethod.COD;
    const subOrderPayloads: Array<{
      subOrderNumber: string;
      vendorId: string;
      status: SubOrderStatus;
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      shippingCharge: Prisma.Decimal;
      shippingMethodSnapshot: Prisma.InputJsonValue;
      taxAmount: Prisma.Decimal;
      total: Prisma.Decimal;
      onlineMerchandiseAmount: Prisma.Decimal;
      onlineShippingAmount: Prisma.Decimal;
      offlineMerchandiseAmount: Prisma.Decimal;
      platformCommissionRate: Prisma.Decimal;
      platformCommission: Prisma.Decimal;
      vendorEarning: Prisma.Decimal;
      items: Array<{
        variantId: string;
        productName: string;
        variantName: string | null;
        sku: string;
        unitPrice: Prisma.Decimal;
        unitSymbol: string;
        quantity: number;
        discountAmount: Prisma.Decimal;
        itemShippingCharge: Prisma.Decimal;
        total: Prisma.Decimal;
        imageUrlSnapshot: string | null;
        imageStorageKeySnapshot: string | null;
      }>;
    }> = [];

    let orderSubtotal = new Prisma.Decimal(0);
    let orderShipping = new Prisma.Decimal(0);
    let orderOnline = new Prisma.Decimal(0);
    let orderOffline = new Prisma.Decimal(0);

    for (const vendorGroup of vendorMap.values()) {
      const breakdown = quote.vendors.find(
        (v) => v.vendorId === vendorGroup.vendorId,
      );
      if (!breakdown) {
        throw new BadRequestException('Shipping calculation failed');
      }

      const vendor = cart.items.find(
        (i) => i.variant.product.vendor.id === vendorGroup.vendorId,
      )!.variant.product.vendor;

      const commissionRate = this.ordersRepository.resolveCommissionRate(
        vendor.commissionRate,
      );

      let subtotal = new Prisma.Decimal(0);
      let vendorDiscount = new Prisma.Decimal(0);
      const items: Array<{
        variantId: string;
        productName: string;
        variantName: string | null;
        sku: string;
        unitPrice: Prisma.Decimal;
        unitSymbol: string;
        quantity: number;
        discountAmount: Prisma.Decimal;
        itemShippingCharge: Prisma.Decimal;
        total: Prisma.Decimal;
        imageUrlSnapshot: string | null;
        imageStorageKeySnapshot: string | null;
      }> = [];

      for (const line of vendorGroup.lines) {
        const cartItem = cart.items.find(
          (i) => i.variant.id === line.variantId,
        )!;
        const unitPrice = cartItem.variant.sellingPrice;
        const lineTotal = unitPrice.mul(line.quantity);
        const lineDiscount =
          discountByVariant.get(line.variantId) ?? new Prisma.Decimal(0);
        subtotal = subtotal.add(lineTotal);
        vendorDiscount = vendorDiscount.add(lineDiscount);

        const lineShip = breakdown.lineCharges.find(
          (c) => c.variantId === line.variantId,
        );
        const itemShippingCharge = new Prisma.Decimal(
          lineShip?.shippingCharge ?? '0',
        );

        const snap =
          resolvedImages.get(line.variantId) ??
          resolvedImages.get(cartItem.variant.product.id);

        items.push({
          variantId: line.variantId,
          productName: cartItem.variant.product.name,
          variantName: cartItem.variant.name,
          sku: cartItem.variant.sku,
          unitPrice,
          unitSymbol: cartItem.variant.primaryUnit.symbol,
          quantity: line.quantity,
          discountAmount: lineDiscount,
          itemShippingCharge,
          total: Prisma.Decimal.max(
            lineTotal.sub(lineDiscount),
            new Prisma.Decimal(0),
          ),
          imageUrlSnapshot: snap?.imageUrlSnapshot ?? null,
          imageStorageKeySnapshot: snap?.imageStorageKeySnapshot ?? null,
        });
      }

      const shippingCharge = new Prisma.Decimal(breakdown.shippingCharge);
      const taxAmount = new Prisma.Decimal(0);
      const merchNet = Prisma.Decimal.max(
        subtotal.sub(vendorDiscount).add(taxAmount),
        new Prisma.Decimal(0),
      );
      const platformCommission = roundMoney(merchNet.mul(commissionRate));
      const onlineMerchandiseAmount = isCod
        ? roundMoney(merchNet.mul(advanceRate))
        : merchNet;
      const offlineMerchandiseAmount = isCod
        ? merchNet.sub(onlineMerchandiseAmount)
        : new Prisma.Decimal(0);
      const onlineShippingAmount = shippingCharge;
      const vendorEarning = onlineMerchandiseAmount
        .sub(platformCommission)
        .add(shippingCharge);
      const total = merchNet.add(shippingCharge);

      orderSubtotal = orderSubtotal.add(subtotal);
      orderShipping = orderShipping.add(shippingCharge);
      orderOnline = orderOnline
        .add(onlineMerchandiseAmount)
        .add(onlineShippingAmount);
      orderOffline = orderOffline.add(offlineMerchandiseAmount);

      const snapshot: Prisma.InputJsonValue =
        freight.freightSource === 'PLATFORM_FLAT'
          ? {
              source: 'PLATFORM_FLAT',
              amount: shippingCharge.toFixed(2),
            }
          : {
              source: 'VENDOR',
              methodType: breakdown.methodType,
              shippingCharge: breakdown.shippingCharge,
              distanceKm: breakdown.distanceKm,
              lineCharges: breakdown.lineCharges,
            };

      subOrderPayloads.push({
        subOrderNumber: this.buildSubOrderNumber(dateStamp),
        vendorId: vendorGroup.vendorId,
        status: subOrderStatus,
        subtotal,
        discountAmount: vendorDiscount,
        shippingCharge,
        shippingMethodSnapshot: snapshot,
        taxAmount,
        total,
        onlineMerchandiseAmount,
        onlineShippingAmount,
        offlineMerchandiseAmount,
        platformCommissionRate: commissionRate,
        platformCommission,
        vendorEarning,
        items,
      });
    }

    const taxTotal = new Prisma.Decimal(0);
    const grandTotal = Prisma.Decimal.max(
      orderSubtotal.add(orderShipping).add(taxTotal).sub(discountAmount),
      new Prisma.Decimal(0),
    );

    if (isCod && orderOnline.lessThanOrEqualTo(0)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COD_ADVANCE_REQUIRED,
        'Cash on delivery requires an online advance',
      );
    }

    let order:
      | NonNullable<
          Awaited<ReturnType<OrdersRepository['createCheckoutOrder']>>
        >
      | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        order = await this.ordersRepository.createCheckoutOrder({
          userId,
          address,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          orderNumber,
          subtotal: orderSubtotal,
          discountAmount,
          couponId,
          shippingTotal: orderShipping,
          taxTotal,
          grandTotal,
          onlineAmount: orderOnline,
          offlineAmount: orderOffline,
          orderStatus,
          paymentStatus,
          subOrders: subOrderPayloads,
          inventoryDecrements,
          cartId: cart.id,
        });
        break;
      } catch (error) {
        if (
          error instanceof ConflictException &&
          String(error.message).includes('Order number')
        ) {
          orderNumber = this.buildOrderNumber(dateStamp);
          continue;
        }
        throw error;
      }
    }

    if (!order) {
      throw new ConflictException('Could not create order');
    }

    const amountPaise = toPaise(orderOnline);
    const razorpayOrder = await this.razorpayClient.createOrder({
      amountPaise,
      receipt: order.orderNumber,
      notes: { orderId: order.id },
    });

    const timeoutMinutes = await this.platformSettings.getNumber(
      'commerce',
      'onlinePaymentTimeoutMinutes',
    );
    const timeoutMs =
      timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : PAYMENT_TIMEOUT_MS;

    const jobId = `${PAYMENT_TIMEOUT_JOB_PREFIX}${order.id}`;
    await this.paymentTimeoutQueue.add(
      'cancel-unpaid-order',
      { orderId: order.id },
      {
        jobId,
        delay: timeoutMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.ordersRepository.updateRazorpayOrderMeta(order.id, {
      razorpayOrderId: razorpayOrder.id,
      paymentTimeoutJobId: jobId,
    });

    const refreshed = await this.ordersRepository.findOrderById(order.id);

    this.notifications.emit({
      userId,
      eventType: NotificationEventType.ORDER_PLACED,
      title: 'Order placed',
      body: `Your order ${order.orderNumber} is awaiting payment`,
      data: { orderId: order.id },
    });

    return {
      message: 'Order created — complete payment',
      data: {
        order: this.serializeOrder(refreshed!, 'customer'),
        razorpayOrder: {
          id: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          key: this.razorpayClient.getKeyId(),
        },
      },
    };
  }

  async listCustomerOrders(userId: string, query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } = await this.ordersRepository.listCustomerOrders(
      userId,
      {
        skip,
        take,
        status: query.status,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
    );

    return {
      message: 'Orders fetched successfully',
      data: items.map((o) => this.serializeOrder(o, 'customer')),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getCustomerOrder(userId: string, orderId: string) {
    const order = await this.ordersRepository.findOrderByIdForUser(
      orderId,
      userId,
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return {
      message: 'Order fetched successfully',
      data: this.serializeOrder(order, 'customer'),
    };
  }

  async listVendorSubOrders(vendorId: string, query: ListSubOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } = await this.ordersRepository.listVendorSubOrders(
      vendorId,
      {
        skip,
        take,
        status: query.status,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
    );

    return {
      message: 'Vendor orders fetched successfully',
      data: items.map((so) => this.serializeSubOrder(so, 'vendor')),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getVendorSubOrder(vendorId: string, subOrderId: string) {
    const so = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );
    if (!so) {
      throw new NotFoundException('Order not found');
    }
    return {
      message: 'Vendor order fetched successfully',
      data: this.serializeSubOrder(so, 'vendor'),
    };
  }

  async updateVendorSubOrderStatus(
    vendorId: string,
    subOrderId: string,
    userId: string,
    dto: UpdateSubOrderStatusDto,
  ) {
    const so = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );
    if (!so) {
      throw new NotFoundException('Order not found');
    }

    if (!isVendorTransitionAllowed(so.status, dto.status)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot transition from ${so.status} to ${dto.status}`,
      );
    }

    const orderId = await this.ordersRepository.updateSubOrderStatus({
      subOrderId,
      fromStatuses: [so.status],
      toStatus: dto.status,
      changedByUserId: userId,
      note: dto.note,
    });

    const order =
      await this.ordersRepository.recomputeParentOrderStatus(orderId);
    const refreshed = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );

    if (dto.status === SubOrderStatus.SHIPPED) {
      this.notifications.emit({
        userId: so.order.userId ?? order.userId,
        eventType: NotificationEventType.ORDER_SHIPPED,
        title: 'Order shipped',
        body: `Sub-order ${so.subOrderNumber} has been shipped`,
        data: { orderId, subOrderId },
      });
    }
    if (dto.status === SubOrderStatus.DELIVERED) {
      this.notifications.emit({
        userId: so.order.userId ?? order.userId,
        eventType: NotificationEventType.ORDER_DELIVERED,
        title: 'Order delivered',
        body: `Sub-order ${so.subOrderNumber} has been delivered`,
        data: { orderId, subOrderId },
      });
    }

    return {
      message: 'Sub-order status updated',
      data: {
        subOrder: this.serializeSubOrder(refreshed!, 'vendor'),
        order: this.serializeOrder(order, 'vendor', vendorId),
      },
    };
  }

  async updateVendorShipment(
    vendorId: string,
    subOrderId: string,
    userId: string,
    dto: UpdateShipmentDto,
  ) {
    const so = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );
    if (!so) {
      throw new NotFoundException('Order not found');
    }

    await this.ordersRepository.updateShipment(subOrderId, {
      trackingNumber: dto.trackingNumber,
      courierName: dto.courierName,
      shippingLabelUrl: dto.shippingLabelUrl,
      estimatedDelivery: dto.estimatedDelivery
        ? new Date(dto.estimatedDelivery)
        : undefined,
      status: dto.status,
      lastUpdatedBy: userId,
    });

    const refreshed = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );

    return {
      message: 'Shipment updated',
      data: this.serializeSubOrder(refreshed!, 'vendor'),
    };
  }

  async listAdminOrders(query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } = await this.ordersRepository.listAdminOrders({
      skip,
      take,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    return {
      message: 'Orders fetched successfully',
      data: items.map((o) => this.serializeOrder(o, 'admin')),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getAdminOrder(orderId: string) {
    const order = await this.ordersRepository.findOrderById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return {
      message: 'Order fetched successfully',
      data: this.serializeOrder(order, 'admin'),
    };
  }

  async adminUpdateOrderStatus(
    orderId: string,
    adminUserId: string,
    dto: AdminUpdateOrderStatusDto,
  ) {
    if (dto.status === OrderStatus.REFUNDED) {
      return this.cancelRefundService.adminRefundOrder({
        orderId,
        actorUserId: adminUserId,
        note: dto.note,
      });
    }

    if (dto.status === OrderStatus.CANCELLED) {
      const existing = await this.ordersRepository.findOrderById(orderId);
      if (!existing) {
        throw new NotFoundException('Order not found');
      }

      const reason = dto.note?.trim() || 'Cancelled by admin';
      for (const so of existing.subOrders) {
        if (
          so.status === SubOrderStatus.CANCELLED ||
          so.status === SubOrderStatus.REFUNDED
        ) {
          continue;
        }
        await this.cancelRefundService.cancelSubOrder({
          subOrderId: so.id,
          orderId,
          actorUserId: adminUserId,
          actorRole: PlatformRole.ADMIN,
          audience: 'admin',
          reason,
        });
      }

      const refreshed = await this.ordersRepository.findOrderById(orderId);
      return {
        message: 'Order cancelled successfully',
        data: this.serializeOrder(refreshed!, 'admin'),
      };
    }

    const order = await this.ordersRepository.adminUpdateOrderStatus(
      orderId,
      dto.status,
      dto.note,
      adminUserId,
    );
    return {
      message: 'Order status updated',
      data: this.serializeOrder(order, 'admin'),
    };
  }

  async listAdminSubOrders(query: ListSubOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } = await this.ordersRepository.listAdminSubOrders({
      skip,
      take,
      status: query.status,
      vendorId: query.vendorId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    return {
      message: 'Sub-orders fetched successfully',
      data: items.map((so) => this.serializeSubOrder(so, 'admin')),
      meta: paginationMeta(page, limit, total),
    };
  }

  async adminUpdateSubOrderStatus(
    subOrderId: string,
    adminUserId: string,
    dto: UpdateSubOrderStatusDto,
  ) {
    const so = await this.ordersRepository.findSubOrderById(subOrderId);
    if (!so) {
      throw new NotFoundException('Sub-order not found');
    }

    if (dto.status === SubOrderStatus.CANCELLED) {
      return this.cancelAdminSubOrder(
        adminUserId,
        subOrderId,
        dto.note?.trim() || 'Cancelled by admin',
      );
    }

    if (dto.status === SubOrderStatus.REFUNDED) {
      return this.cancelRefundService.adminRefundOrder({
        orderId: so.order.id,
        actorUserId: adminUserId,
        note: dto.note,
        subOrderId,
      });
    }

    if (!isAdminTransitionAllowed(so.status, dto.status)) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Cannot transition from ${so.status} to ${dto.status}`,
      );
    }

    const orderId = await this.ordersRepository.updateSubOrderStatus({
      subOrderId,
      fromStatuses: [so.status],
      toStatus: dto.status,
      changedByUserId: adminUserId,
      note: dto.note,
    });

    const order =
      await this.ordersRepository.recomputeParentOrderStatus(orderId);
    const refreshed = await this.ordersRepository.findSubOrderById(subOrderId);

    return {
      message: 'Sub-order status updated',
      data: {
        subOrder: this.serializeSubOrder(refreshed!, 'admin'),
        order: this.serializeOrder(order, 'admin'),
      },
    };
  }

  async adminRefund(orderId: string, adminUserId: string, dto: AdminRefundDto) {
    return this.cancelRefundService.adminRefundOrder({
      orderId,
      actorUserId: adminUserId,
      note: dto.note,
      subOrderId: dto.subOrderId,
    });
  }

  async cancelCustomerSubOrder(
    userId: string,
    orderId: string,
    subOrderId: string,
    reason?: string,
  ) {
    return this.cancelRefundService.cancelSubOrder({
      subOrderId,
      orderId,
      actorUserId: userId,
      actorRole: PlatformRole.CUSTOMER,
      audience: 'customer',
      reason: reason?.trim() || 'Cancelled by customer',
    });
  }

  async cancelVendorSubOrder(
    vendorId: string,
    userId: string,
    subOrderId: string,
    reason: string,
  ) {
    return this.cancelRefundService.cancelSubOrder({
      subOrderId,
      vendorId,
      actorUserId: userId,
      actorRole: PlatformRole.VENDOR,
      audience: 'vendor',
      reason,
    });
  }

  async cancelAdminSubOrder(
    adminUserId: string,
    subOrderId: string,
    reason: string,
  ) {
    return this.cancelRefundService.cancelSubOrder({
      subOrderId,
      actorUserId: adminUserId,
      actorRole: PlatformRole.ADMIN,
      audience: 'admin',
      reason,
    });
  }

  async captureOnlinePayment(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    expectedUserId?: string;
  }) {
    const order = await this.ordersRepository.findOrderByRazorpayOrderId(
      input.razorpayOrderId,
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (input.expectedUserId && order.userId !== input.expectedUserId) {
      throw new ForbiddenException('Order does not belong to user');
    }

    const result = await this.ordersRepository.captureOnlinePayment({
      orderId: order.id,
      razorpayPaymentId: input.razorpayPaymentId,
    });

    if (result.paymentTimeoutJobId) {
      try {
        const job = await this.paymentTimeoutQueue.getJob(
          result.paymentTimeoutJobId,
        );
        if (job) {
          await job.remove();
        }
      } catch {
        // ignore missing job
      }
    }

    const refreshed = await this.ordersRepository.findOrderById(order.id);
    if (refreshed && !result.alreadyPaid) {
      this.notifications.emit({
        userId: refreshed.userId,
        eventType: NotificationEventType.ORDER_PAID,
        title: 'Payment received',
        body: `Payment confirmed for order ${refreshed.orderNumber}`,
        data: { orderId: refreshed.id },
      });
    }

    return {
      alreadyPaid: result.alreadyPaid,
      order: refreshed
        ? this.serializeOrder(
            refreshed,
            input.expectedUserId ? 'customer' : 'admin',
          )
        : null,
    };
  }

  async handlePaymentTimeout(orderId: string) {
    const result = await this.ordersRepository.cancelTimedOutOrder(orderId);
    if (result) {
      this.notifications.emit({
        userId: result.userId,
        eventType: NotificationEventType.ORDER_CANCELLED,
        title: 'Order cancelled',
        body: 'Order cancelled due to payment timeout',
        data: { orderId: result.orderId },
      });
    }
  }

  serializeOrderForAudience(
    order: {
      subtotal: Prisma.Decimal | string;
      discountAmount: Prisma.Decimal | string;
      shippingTotal: Prisma.Decimal | string;
      taxTotal: Prisma.Decimal | string;
      grandTotal: Prisma.Decimal | string;
      subOrders: Array<Record<string, unknown>>;
      [key: string]: unknown;
    },
    audience: 'customer' | 'vendor' | 'admin',
    vendorId?: string,
  ) {
    return this.serializeOrder(order as never, audience, vendorId);
  }

  private formatDateStamp(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private buildOrderNumber(dateStamp: string): string {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `YC-${dateStamp}-${rand}`;
  }

  private buildSubOrderNumber(dateStamp: string): string {
    const short = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `YC-${dateStamp}-V-${short}`;
  }

  private serializeOrder(
    order: {
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      shippingTotal: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      grandTotal: Prisma.Decimal;
      subOrders: Array<Record<string, unknown>>;
      [key: string]: unknown;
    },
    audience: 'customer' | 'vendor' | 'admin',
    vendorId?: string,
  ) {
    const subOrders =
      audience === 'vendor' && vendorId
        ? order.subOrders.filter((so) => so.vendorId === vendorId)
        : order.subOrders;

    const serialized: Record<string, unknown> = {
      ...order,
      subtotal: formatMoney(order.subtotal),
      discountAmount: formatMoney(order.discountAmount),
      shippingTotal: formatMoney(order.shippingTotal),
      taxTotal: formatMoney(order.taxTotal),
      grandTotal: formatMoney(order.grandTotal),
      onlineAmount:
        order.onlineAmount != null
          ? formatMoney(order.onlineAmount as Prisma.Decimal)
          : undefined,
      offlineAmount:
        order.offlineAmount != null
          ? formatMoney(order.offlineAmount as Prisma.Decimal)
          : undefined,
      subOrders: subOrders.map((so) =>
        this.serializeSubOrder(so as never, audience),
      ),
    };

    if (audience === 'customer') {
      delete serialized.paymentTimeoutJobId;
      delete serialized.razorpayPaymentId;
    }

    return serialized;
  }

  private serializeSubOrder(
    so: {
      subtotal: Prisma.Decimal;
      shippingCharge: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      total: Prisma.Decimal;
      platformCommissionRate: Prisma.Decimal;
      platformCommission: Prisma.Decimal;
      vendorEarning: Prisma.Decimal;
      items?: Array<{
        unitPrice: Prisma.Decimal;
        itemShippingCharge: Prisma.Decimal;
        total: Prisma.Decimal;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    },
    audience: 'customer' | 'vendor' | 'admin',
  ) {
    const serialized: Record<string, unknown> = {
      ...so,
      subtotal: formatMoney(so.subtotal),
      discountAmount:
        so.discountAmount != null
          ? formatMoney(so.discountAmount as Prisma.Decimal)
          : undefined,
      shippingCharge: formatMoney(so.shippingCharge),
      taxAmount: formatMoney(so.taxAmount),
      total: formatMoney(so.total),
      onlineMerchandiseAmount:
        so.onlineMerchandiseAmount != null
          ? formatMoney(so.onlineMerchandiseAmount as Prisma.Decimal)
          : undefined,
      onlineShippingAmount:
        so.onlineShippingAmount != null
          ? formatMoney(so.onlineShippingAmount as Prisma.Decimal)
          : undefined,
      offlineMerchandiseAmount:
        so.offlineMerchandiseAmount != null
          ? formatMoney(so.offlineMerchandiseAmount as Prisma.Decimal)
          : undefined,
      platformCommissionRate: formatRate(so.platformCommissionRate),
      platformCommission: formatMoney(so.platformCommission),
      vendorEarning: formatMoney(so.vendorEarning),
      items: so.items?.map((item) => ({
        ...item,
        unitPrice: formatMoney(item.unitPrice),
        discountAmount:
          item.discountAmount != null
            ? formatMoney(item.discountAmount as Prisma.Decimal)
            : undefined,
        itemShippingCharge: formatMoney(item.itemShippingCharge),
        total: formatMoney(item.total),
      })),
      deliveries: Array.isArray(so.deliveries)
        ? (so.deliveries as Array<Record<string, unknown>>).map((d) =>
            this.serializeDelivery(d, audience),
          )
        : so.deliveries,
    };

    if (audience === 'customer') {
      delete serialized.platformCommissionRate;
      delete serialized.platformCommission;
      delete serialized.vendorEarning;
      delete serialized.walletCreditedAt;
    }

    return serialized;
  }

  private serializeDelivery(
    delivery: Record<string, unknown>,
    audience: 'customer' | 'vendor' | 'admin',
  ) {
    const serialized: Record<string, unknown> = {
      ...delivery,
      offlineAmountDue:
        delivery.offlineAmountDue != null
          ? formatMoney(delivery.offlineAmountDue as Prisma.Decimal)
          : undefined,
      offlineAmountCollected:
        delivery.offlineAmountCollected != null
          ? formatMoney(delivery.offlineAmountCollected as Prisma.Decimal)
          : undefined,
      walletCreditAmount:
        delivery.walletCreditAmount != null
          ? formatMoney(delivery.walletCreditAmount as Prisma.Decimal)
          : undefined,
    };
    if (audience === 'customer') {
      delete serialized.walletCreditAmount;
      delete serialized.walletCreditedAt;
      delete serialized.overriddenByUserId;
    }
    return serialized;
  }
}
