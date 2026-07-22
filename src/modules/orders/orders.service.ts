import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ShipmentStatus,
  SubOrderStatus,
} from '../../../generated/prisma/client.js';
import {
  paginate,
  paginationMeta,
} from '../../common/utils/pagination.util';
import { PAYMENT_TIMEOUT_QUEUE } from '../../queue/queue.constants';
import { RazorpayClient } from '../payments/razorpay.client';
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
import { OrdersRepository } from './orders.repository';
import {
  ShippingQuoteService,
  type VendorShippingQuoteInput,
} from './shipping-quote.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly shippingQuoteService: ShippingQuoteService,
    @Inject(forwardRef(() => RazorpayClient))
    private readonly razorpayClient: RazorpayClient,
    @InjectQueue(PAYMENT_TIMEOUT_QUEUE)
    private readonly paymentTimeoutQueue: Queue,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const address = await this.ordersRepository.findAddressForUser(
      userId,
      dto.addressId,
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    const cart = await this.ordersRepository.findCartWithShippingData(userId);
    if (!cart) {
      throw new BadRequestException('Cart is empty');
    }
    this.ordersRepository.assertCheckoutCartValid(cart);

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
              freeAboveOrderValue:
                product.shippingOverride.freeAboveOrderValue,
              freeWithinKm: product.shippingOverride.freeWithinKm,
              chargeBeyondKm: product.shippingOverride.chargeBeyondKm,
              unitCharge: product.shippingOverride.unitCharge,
              unitType: product.shippingOverride.unitType,
            }
          : null,
      });
    }

    const quote = this.shippingQuoteService.computeQuote([...vendorMap.values()], {
      latitude: address.latitude,
      longitude: address.longitude,
    });

    const isCod = dto.paymentMethod === PaymentMethod.COD;
    const orderStatus = isCod
      ? OrderStatus.CONFIRMED
      : OrderStatus.PENDING_PAYMENT;
    const paymentStatus = PaymentStatus.PENDING;
    const subOrderStatus = isCod
      ? SubOrderStatus.CONFIRMED
      : SubOrderStatus.PENDING;

    const dateStamp = this.formatDateStamp(new Date());
    let orderNumber = this.buildOrderNumber(dateStamp);
    const subOrderPayloads: Array<{
      subOrderNumber: string;
      vendorId: string;
      status: SubOrderStatus;
      subtotal: Prisma.Decimal;
      shippingCharge: Prisma.Decimal;
      shippingMethodSnapshot: Prisma.InputJsonValue;
      taxAmount: Prisma.Decimal;
      total: Prisma.Decimal;
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
        itemShippingCharge: Prisma.Decimal;
        total: Prisma.Decimal;
      }>;
    }> = [];

    let orderSubtotal = new Prisma.Decimal(0);
    let orderShipping = new Prisma.Decimal(0);

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

      const commissionRate =
        this.ordersRepository.resolveCommissionRate(vendor.commissionRate);

      let subtotal = new Prisma.Decimal(0);
      const items: Array<{
        variantId: string;
        productName: string;
        variantName: string | null;
        sku: string;
        unitPrice: Prisma.Decimal;
        unitSymbol: string;
        quantity: number;
        itemShippingCharge: Prisma.Decimal;
        total: Prisma.Decimal;
      }> = [];

      for (const line of vendorGroup.lines) {
        const cartItem = cart.items.find(
          (i) => i.variant.id === line.variantId,
        )!;
        const unitPrice = cartItem.variant.sellingPrice;
        const lineTotal = unitPrice.mul(line.quantity);
        subtotal = subtotal.add(lineTotal);

        const lineShip = breakdown.lineCharges.find(
          (c) => c.variantId === line.variantId,
        );
        const itemShippingCharge = new Prisma.Decimal(
          lineShip?.shippingCharge ?? '0',
        );

        items.push({
          variantId: line.variantId,
          productName: cartItem.variant.product.name,
          variantName: cartItem.variant.name,
          sku: cartItem.variant.sku,
          unitPrice,
          unitSymbol: cartItem.variant.primaryUnit.symbol,
          quantity: line.quantity,
          itemShippingCharge,
          total: lineTotal,
        });
      }

      const shippingCharge = new Prisma.Decimal(breakdown.shippingCharge);
      const platformCommission = subtotal
        .mul(commissionRate)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const vendorEarning = subtotal
        .sub(platformCommission)
        .add(shippingCharge);
      const taxAmount = new Prisma.Decimal(0);
      const total = subtotal.add(shippingCharge).add(taxAmount);

      orderSubtotal = orderSubtotal.add(subtotal);
      orderShipping = orderShipping.add(shippingCharge);

      subOrderPayloads.push({
        subOrderNumber: this.buildSubOrderNumber(dateStamp),
        vendorId: vendorGroup.vendorId,
        status: subOrderStatus,
        subtotal,
        shippingCharge,
        shippingMethodSnapshot: {
          methodType: breakdown.methodType,
          shippingCharge: breakdown.shippingCharge,
          distanceKm: breakdown.distanceKm,
          lineCharges: breakdown.lineCharges,
        } as Prisma.InputJsonValue,
        taxAmount,
        total,
        platformCommissionRate: commissionRate,
        platformCommission,
        vendorEarning,
        items,
      });
    }

    const taxTotal = new Prisma.Decimal(0);
    const grandTotal = orderSubtotal.add(orderShipping).add(taxTotal);

    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        order = await this.ordersRepository.createCheckoutOrder({
          userId,
          address,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          orderNumber,
          subtotal: orderSubtotal,
          shippingTotal: orderShipping,
          taxTotal,
          grandTotal,
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

    if (isCod) {
      return {
        message: 'Order placed successfully',
        data: { order: this.serializeOrder(order) },
      };
    }

    const amountPaise = Number(grandTotal.mul(100).toFixed(0));
    const razorpayOrder = await this.razorpayClient.createOrder({
      amountPaise,
      receipt: order.orderNumber,
      notes: { orderId: order.id },
    });

    const jobId = `${PAYMENT_TIMEOUT_JOB_PREFIX}${order.id}`;
    await this.paymentTimeoutQueue.add(
      'cancel-unpaid-order',
      { orderId: order.id },
      {
        jobId,
        delay: PAYMENT_TIMEOUT_MS,
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

    return {
      message: 'Order created — complete payment',
      data: {
        order: this.serializeOrder(refreshed!),
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
      data: items.map((o) => this.serializeOrder(o)),
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
      data: this.serializeOrder(order),
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
      data: items.map((so) => this.serializeSubOrder(so)),
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
      data: this.serializeSubOrder(so),
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
      throw new BadRequestException(
        `Cannot transition from ${so.status} to ${dto.status}`,
      );
    }

    if (
      dto.status === SubOrderStatus.SHIPPED &&
      (!so.shipment?.trackingNumber && !dto.note)
    ) {
      // tracking recommended but allow if shipment update done separately
    }

    const shipmentUpdate =
      dto.status === SubOrderStatus.SHIPPED
        ? {
            status: ShipmentStatus.SHIPPED,
            shippedAt: new Date(),
          }
        : dto.status === SubOrderStatus.OUT_FOR_DELIVERY
          ? { status: ShipmentStatus.OUT_FOR_DELIVERY }
          : dto.status === SubOrderStatus.DELIVERED
            ? {
                status: ShipmentStatus.DELIVERED,
                deliveredAt: new Date(),
              }
            : undefined;

    const orderId = await this.ordersRepository.updateSubOrderStatus({
      subOrderId,
      fromStatuses: [so.status],
      toStatus: dto.status,
      changedByUserId: userId,
      note: dto.note,
      shipmentUpdate,
    });

    if (
      dto.status === SubOrderStatus.DELIVERED &&
      so.order.paymentMethod === PaymentMethod.COD
    ) {
      await this.ordersRepository.creditWalletForSubOrderId(subOrderId);
    }

    const order = await this.ordersRepository.recomputeParentOrderStatus(
      orderId,
    );
    const refreshed = await this.ordersRepository.findSubOrderForVendor(
      subOrderId,
      vendorId,
    );

    return {
      message: 'Sub-order status updated',
      data: {
        subOrder: this.serializeSubOrder(refreshed!),
        order: this.serializeOrder(order),
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
      data: this.serializeSubOrder(refreshed!),
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
      data: items.map((o) => this.serializeOrder(o)),
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
      data: this.serializeOrder(order),
    };
  }

  async adminUpdateOrderStatus(
    orderId: string,
    adminUserId: string,
    dto: AdminUpdateOrderStatusDto,
  ) {
    const order = await this.ordersRepository.adminUpdateOrderStatus(
      orderId,
      dto.status,
      dto.note,
      adminUserId,
    );
    return {
      message: 'Order status updated',
      data: this.serializeOrder(order),
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
      data: items.map((so) => this.serializeSubOrder(so)),
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

    if (!isAdminTransitionAllowed(so.status, dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${so.status} to ${dto.status}`,
      );
    }

    const shipmentUpdate =
      dto.status === SubOrderStatus.SHIPPED
        ? { status: ShipmentStatus.SHIPPED, shippedAt: new Date() }
        : dto.status === SubOrderStatus.OUT_FOR_DELIVERY
          ? { status: ShipmentStatus.OUT_FOR_DELIVERY }
          : dto.status === SubOrderStatus.DELIVERED
            ? {
                status: ShipmentStatus.DELIVERED,
                deliveredAt: new Date(),
              }
            : undefined;

    const orderId = await this.ordersRepository.updateSubOrderStatus({
      subOrderId,
      fromStatuses: [so.status],
      toStatus: dto.status,
      changedByUserId: adminUserId,
      note: dto.note,
      shipmentUpdate,
    });

    if (
      dto.status === SubOrderStatus.DELIVERED &&
      so.order.paymentMethod === PaymentMethod.COD
    ) {
      await this.ordersRepository.creditWalletForSubOrderId(subOrderId);
    }

    const order = await this.ordersRepository.recomputeParentOrderStatus(
      orderId,
    );
    const refreshed = await this.ordersRepository.findSubOrderById(subOrderId);

    return {
      message: 'Sub-order status updated',
      data: {
        subOrder: this.serializeSubOrder(refreshed!),
        order: this.serializeOrder(order),
      },
    };
  }

  async adminRefund(
    orderId: string,
    adminUserId: string,
    dto: AdminRefundDto,
  ) {
    const order = await this.ordersRepository.stubRefund(
      orderId,
      dto.note,
      adminUserId,
    );
    return {
      message: 'Order refunded (stub — no payment reversal)',
      data: this.serializeOrder(order),
    };
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

    if (
      input.expectedUserId &&
      order.userId !== input.expectedUserId
    ) {
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
    return {
      alreadyPaid: result.alreadyPaid,
      order: refreshed ? this.serializeOrder(refreshed) : null,
    };
  }

  async handlePaymentTimeout(orderId: string) {
    await this.ordersRepository.cancelTimedOutOrder(orderId);
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

  private serializeOrder(order: {
    subtotal: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    shippingTotal: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    subOrders: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }) {
    return {
      ...order,
      subtotal: order.subtotal.toString(),
      discountAmount: order.discountAmount.toString(),
      shippingTotal: order.shippingTotal.toString(),
      taxTotal: order.taxTotal.toString(),
      grandTotal: order.grandTotal.toString(),
      subOrders: order.subOrders.map((so) => this.serializeSubOrder(so as never)),
    };
  }

  private serializeSubOrder(so: {
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
  }) {
    return {
      ...so,
      subtotal: so.subtotal.toString(),
      shippingCharge: so.shippingCharge.toString(),
      taxAmount: so.taxAmount.toString(),
      total: so.total.toString(),
      platformCommissionRate: so.platformCommissionRate.toString(),
      platformCommission: so.platformCommission.toString(),
      vendorEarning: so.vendorEarning.toString(),
      items: so.items?.map((item) => ({
        ...item,
        unitPrice: item.unitPrice.toString(),
        itemShippingCharge: item.itemShippingCharge.toString(),
        total: item.total.toString(),
      })),
    };
  }
}
