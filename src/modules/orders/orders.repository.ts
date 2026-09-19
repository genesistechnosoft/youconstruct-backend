import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
  DeliveryStatus,
  OrderRefundStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PlatformRole,
  Prisma,
  ProductStatus,
  RestockStatus,
  ShipmentStatus,
  SubOrderStatus,
  TransactionReason,
  TransactionType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import {
  aggregateParentOrderStatus,
  aggregateParentOrderStatusFromQty,
  deriveSubOrderStatusFromQty,
} from './order-status.util';
import { DEFAULT_PLATFORM_COMMISSION_RATE } from './order.constants';

const ADDRESS_SELECT = {
  id: true,
  userId: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  phone: true,
  latitude: true,
  longitude: true,
} as const;

const SHIPPING_METHOD_SELECT = {
  methodType: true,
  flatCharge: true,
  isFree: true,
  freeAboveOrderValue: true,
  freeWithinKm: true,
  chargeBeyondKm: true,
  unitCharge: true,
  unitType: true,
  isActive: true,
  orderValueTiers: {
    select: {
      minOrderValue: true,
      maxOrderValue: true,
      shippingCharge: true,
    },
    orderBy: { minOrderValue: 'asc' as const },
  },
} as const;

const OVERRIDE_SELECT = {
  methodType: true,
  flatCharge: true,
  isFree: true,
  freeAboveOrderValue: true,
  freeWithinKm: true,
  chargeBeyondKm: true,
  unitCharge: true,
  unitType: true,
} as const;

const ORDER_CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
} as const;

const ORDER_PARENT_SELECT = {
  id: true,
  orderNumber: true,
  paymentMethod: true,
  paymentStatus: true,
  status: true,
  userId: true,
  addressId: true,
  addressLabel: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressState: true,
  addressPincode: true,
  addressPhone: true,
  addressLatitude: true,
  addressLongitude: true,
  user: { select: ORDER_CUSTOMER_SELECT },
} as const;

export const ORDER_DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  user: { select: ORDER_CUSTOMER_SELECT },
  addressId: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  subtotal: true,
  discountAmount: true,
  shippingTotal: true,
  taxTotal: true,
  grandTotal: true,
  onlineAmount: true,
  offlineAmount: true,
  addressLabel: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressState: true,
  addressPincode: true,
  addressPhone: true,
  addressLatitude: true,
  addressLongitude: true,
  razorpayOrderId: true,
  razorpayPaymentId: true,
  paymentTimeoutJobId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  subOrders: {
    select: {
      id: true,
      subOrderNumber: true,
      vendorId: true,
      status: true,
      subtotal: true,
      discountAmount: true,
      shippingCharge: true,
      shippingMethodSnapshot: true,
      taxAmount: true,
      total: true,
      onlineMerchandiseAmount: true,
      onlineShippingAmount: true,
      offlineMerchandiseAmount: true,
      platformCommissionRate: true,
      platformCommission: true,
      vendorEarning: true,
      walletCreditedAt: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      vendor: {
        select: { id: true, businessName: true },
      },
      items: {
        select: {
          id: true,
          variantId: true,
          productName: true,
          variantName: true,
          sku: true,
          unitPrice: true,
          unitSymbol: true,
          quantity: true,
          cancelledQuantity: true,
          discountAmount: true,
          itemShippingCharge: true,
          total: true,
          imageUrlSnapshot: true,
          imageStorageKeySnapshot: true,
        },
      },
      shipment: {
        select: {
          id: true,
          trackingNumber: true,
          courierName: true,
          shippingLabelUrl: true,
          estimatedDelivery: true,
          shippedAt: true,
          deliveredAt: true,
          status: true,
          updatedAt: true,
        },
      },
      deliveries: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          deliveryNumber: true,
          status: true,
          trackingNumber: true,
          courierName: true,
          shippingLabelUrl: true,
          estimatedDelivery: true,
          shippedAt: true,
          deliveredAt: true,
          vendorRemarks: true,
          customerRemarks: true,
          overrideReason: true,
          offlineAmountDue: true,
          offlineAmountCollected: true,
          walletCreditAmount: true,
          walletCreditedAt: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              orderItemId: true,
              quantity: true,
            },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          status: true,
          note: true,
          changedByUserId: true,
          createdAt: true,
        },
      },
    },
  },
} as const;

const SUB_ORDER_LIST_SELECT = {
  id: true,
  subOrderNumber: true,
  vendorId: true,
  status: true,
  subtotal: true,
  discountAmount: true,
  shippingCharge: true,
  taxAmount: true,
  total: true,
  onlineMerchandiseAmount: true,
  onlineShippingAmount: true,
  offlineMerchandiseAmount: true,
  platformCommissionRate: true,
  platformCommission: true,
  vendorEarning: true,
  walletCreditedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  vendor: {
    select: { id: true, businessName: true },
  },
  items: {
    select: {
      id: true,
      variantId: true,
      productName: true,
      variantName: true,
      sku: true,
      unitPrice: true,
      unitSymbol: true,
      quantity: true,
      cancelledQuantity: true,
      discountAmount: true,
      itemShippingCharge: true,
      total: true,
      imageUrlSnapshot: true,
      imageStorageKeySnapshot: true,
    },
  },
  deliveries: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      deliveryNumber: true,
      status: true,
      shippedAt: true,
      deliveredAt: true,
      trackingNumber: true,
      courierName: true,
      vendorRemarks: true,
      customerRemarks: true,
      offlineAmountDue: true,
      offlineAmountCollected: true,
      walletCreditAmount: true,
      items: {
        select: {
          id: true,
          orderItemId: true,
          quantity: true,
        },
      },
    },
  },
  shipment: {
    select: {
      id: true,
      trackingNumber: true,
      courierName: true,
      status: true,
      shippedAt: true,
      deliveredAt: true,
      updatedAt: true,
    },
  },
} as const;

export const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  subtotal: true,
  discountAmount: true,
  shippingTotal: true,
  taxTotal: true,
  grandTotal: true,
  onlineAmount: true,
  offlineAmount: true,
  addressCity: true,
  addressState: true,
  addressPincode: true,
  razorpayOrderId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  user: { select: ORDER_CUSTOMER_SELECT },
  subOrders: {
    select: SUB_ORDER_LIST_SELECT,
  },
} as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAddressForUser(userId: string, addressId: string) {
    return this.prisma.address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
      select: ADDRESS_SELECT,
    });
  }

  findUserPhone(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
  }

  findCartWithShippingData(userId: string) {
    return this.prisma.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                id: true,
                sku: true,
                name: true,
                sellingPrice: true,
                isActive: true,
                deletedAt: true,
                weightKg: true,
                coverageArea: true,
                primaryUnit: { select: { symbol: true } },
                inventory: {
                  select: { quantity: true, allowBackorder: true },
                },
                product: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    deletedAt: true,
                    categoryId: true,
                    brandId: true,
                    brand: { select: { isActive: true } },
                    shippingOverride: { select: OVERRIDE_SELECT },
                    vendor: {
                      select: {
                        id: true,
                        businessName: true,
                        isApproved: true,
                        deletedAt: true,
                        latitude: true,
                        longitude: true,
                        commissionRate: true,
                        shippingMethod: { select: SHIPPING_METHOD_SELECT },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async createCheckoutOrder(input: {
    userId: string;
    address: {
      id: string;
      label: string | null;
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      pincode: string;
      phone: string | null;
      latitude: number | null;
      longitude: number | null;
    };
    paymentMethod: PaymentMethod;
    notes?: string;
    orderNumber: string;
    subtotal: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    couponId?: string | null;
    shippingTotal: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    onlineAmount: Prisma.Decimal;
    offlineAmount: Prisma.Decimal;
    orderStatus: OrderStatus;
    paymentStatus: PaymentStatus;
    subOrders: Array<{
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
        imageUrlSnapshot?: string | null;
        imageStorageKeySnapshot?: string | null;
      }>;
    }>;
    inventoryDecrements: Array<{ variantId: string; quantity: number }>;
    cartId: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        for (const dec of input.inventoryDecrements) {
          const updated = await tx.productInventory.updateMany({
            where: {
              variantId: dec.variantId,
              OR: [
                { allowBackorder: true },
                { quantity: { gte: dec.quantity } },
              ],
            },
            data: { quantity: { decrement: dec.quantity } },
          });
          if (updated.count === 0) {
            throw new ConflictException(
              `Insufficient stock for variant ${dec.variantId}`,
            );
          }
        }

        const order = await tx.order.create({
          data: {
            orderNumber: input.orderNumber,
            userId: input.userId,
            addressId: input.address.id,
            status: input.orderStatus,
            paymentStatus: input.paymentStatus,
            paymentMethod: input.paymentMethod,
            subtotal: input.subtotal,
            discountAmount: input.discountAmount,
            couponId: input.couponId ?? null,
            shippingTotal: input.shippingTotal,
            taxTotal: input.taxTotal,
            grandTotal: input.grandTotal,
            onlineAmount: input.onlineAmount,
            offlineAmount: input.offlineAmount,
            addressLabel: input.address.label,
            addressLine1: input.address.line1,
            addressLine2: input.address.line2,
            addressCity: input.address.city,
            addressState: input.address.state,
            addressPincode: input.address.pincode,
            addressPhone: input.address.phone,
            addressLatitude: input.address.latitude,
            addressLongitude: input.address.longitude,
            notes: input.notes ?? null,
            subOrders: {
              create: input.subOrders.map((so) => ({
                subOrderNumber: so.subOrderNumber,
                vendorId: so.vendorId,
                status: so.status,
                subtotal: so.subtotal,
                discountAmount: so.discountAmount,
                shippingCharge: so.shippingCharge,
                shippingMethodSnapshot: so.shippingMethodSnapshot,
                taxAmount: so.taxAmount,
                total: so.total,
                onlineMerchandiseAmount: so.onlineMerchandiseAmount,
                onlineShippingAmount: so.onlineShippingAmount,
                offlineMerchandiseAmount: so.offlineMerchandiseAmount,
                platformCommissionRate: so.platformCommissionRate,
                platformCommission: so.platformCommission,
                vendorEarning: so.vendorEarning,
                items: {
                  create: so.items.map((item) => ({
                    variantId: item.variantId,
                    productName: item.productName,
                    variantName: item.variantName,
                    sku: item.sku,
                    unitPrice: item.unitPrice,
                    unitSymbol: item.unitSymbol,
                    quantity: item.quantity,
                    discountAmount: item.discountAmount,
                    itemShippingCharge: item.itemShippingCharge,
                    total: item.total,
                    imageUrlSnapshot: item.imageUrlSnapshot ?? null,
                    imageStorageKeySnapshot:
                      item.imageStorageKeySnapshot ?? null,
                  })),
                },
                statusHistory: {
                  create: {
                    status: so.status,
                    changedByUserId: input.userId,
                    note: 'Order placed',
                  },
                },
              })),
            },
          },
          select: ORDER_DETAIL_SELECT,
        });

        if (input.couponId && input.discountAmount.greaterThan(0)) {
          await tx.couponUsage.create({
            data: {
              couponId: input.couponId,
              userId: input.userId,
              orderId: order.id,
              amount: input.discountAmount,
            },
          });
        }

        await tx.cartItem.deleteMany({ where: { cartId: input.cartId } });
        return order;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Order number conflict — retry');
      }
      throw error;
    }
  }

  async findPrimaryImageSnapshots(
    productIds: string[],
    variantIds: string[],
  ): Promise<
    Map<
      string,
      {
        imageUrlSnapshot: string | null;
        imageStorageKeySnapshot: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        imageUrlSnapshot: string | null;
        imageStorageKeySnapshot: string | null;
      }
    >();

    if (variantIds.length === 0 && productIds.length === 0) {
      return result;
    }

    const links = await this.prisma.mediaLink.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            entityType: MediaEntityType.PRODUCT,
            entityId: { in: productIds },
            context: MediaContext.THUMBNAIL,
          },
          {
            entityType: MediaEntityType.PRODUCT_VARIANT,
            entityId: { in: variantIds },
            context: { in: [MediaContext.PRIMARY, MediaContext.GALLERY] },
          },
          {
            entityType: MediaEntityType.PRODUCT,
            entityId: { in: productIds },
            context: { in: [MediaContext.PRIMARY, MediaContext.GALLERY] },
          },
        ],
        media: {
          deletedAt: null,
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      select: {
        entityType: true,
        entityId: true,
        context: true,
        isPrimary: true,
        sortOrder: true,
        media: {
          select: {
            optimizedKey: true,
            originalKey: true,
            thumbnailKey: true,
            accessLevel: true,
          },
        },
      },
    });

    const applyLink = (link: (typeof links)[number]) => {
      if (result.has(link.entityId)) {
        return;
      }
      const key =
        link.media.optimizedKey ??
        link.media.thumbnailKey ??
        link.media.originalKey;
      result.set(link.entityId, {
        imageStorageKeySnapshot: key,
        imageUrlSnapshot: null,
      });
    };

    for (const link of links) {
      if (link.context === MediaContext.THUMBNAIL) {
        applyLink(link);
      }
    }
    for (const link of links) {
      if (link.context !== MediaContext.THUMBNAIL) {
        applyLink(link);
      }
    }

    return result;
  }

  updateRazorpayOrderMeta(
    orderId: string,
    data: { razorpayOrderId: string; paymentTimeoutJobId: string },
  ) {
    return this.prisma.order.update({
      where: { id: orderId },
      data,
      select: { id: true, razorpayOrderId: true, paymentTimeoutJobId: true },
    });
  }

  findOrderById(orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: ORDER_DETAIL_SELECT,
    });
  }

  findOrderByIdForUser(orderId: string, userId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId, deletedAt: null },
      select: ORDER_DETAIL_SELECT,
    });
  }

  findOrderByRazorpayOrderId(razorpayOrderId: string) {
    return this.prisma.order.findFirst({
      where: { razorpayOrderId, deletedAt: null },
      select: {
        ...ORDER_DETAIL_SELECT,
        paymentTimeoutJobId: true,
      },
    });
  }

  async listCustomerOrders(
    userId: string,
    filters: {
      skip: number;
      take: number;
      status?: OrderStatus;
      from?: Date;
      to?: Date;
    },
  ) {
    const where: Prisma.OrderWhereInput = {
      userId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: ORDER_LIST_SELECT,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total };
  }

  async listAdminOrders(filters: {
    skip: number;
    take: number;
    status?: OrderStatus;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: ORDER_LIST_SELECT,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total };
  }

  async listVendorSubOrders(
    vendorId: string,
    filters: {
      skip: number;
      take: number;
      status?: SubOrderStatus;
      from?: Date;
      to?: Date;
    },
  ) {
    const where: Prisma.SubOrderWhereInput = {
      vendorId,
      order: { deletedAt: null },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: {
          ...SUB_ORDER_LIST_SELECT,
          order: {
            select: ORDER_PARENT_SELECT,
          },
        },
      }),
      this.prisma.subOrder.count({ where }),
    ]);

    return { items, total };
  }

  async listAdminSubOrders(filters: {
    skip: number;
    take: number;
    status?: SubOrderStatus;
    vendorId?: string;
    from?: Date;
    to?: Date;
  }) {
    const where: Prisma.SubOrderWhereInput = {
      order: { deletedAt: null },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.subOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: {
          ...SUB_ORDER_LIST_SELECT,
          order: {
            select: ORDER_PARENT_SELECT,
          },
        },
      }),
      this.prisma.subOrder.count({ where }),
    ]);

    return { items, total };
  }

  findSubOrderForVendor(subOrderId: string, vendorId: string) {
    return this.prisma.subOrder.findFirst({
      where: {
        id: subOrderId,
        vendorId,
        order: { deletedAt: null },
      },
      select: {
        ...ORDER_DETAIL_SELECT.subOrders.select,
        order: {
          select: ORDER_PARENT_SELECT,
        },
      },
    });
  }

  findSubOrderById(subOrderId: string) {
    return this.prisma.subOrder.findFirst({
      where: { id: subOrderId, order: { deletedAt: null } },
      select: {
        ...ORDER_DETAIL_SELECT.subOrders.select,
        order: {
          select: ORDER_PARENT_SELECT,
        },
      },
    });
  }

  async updateSubOrderStatus(input: {
    subOrderId: string;
    fromStatuses: SubOrderStatus[];
    toStatus: SubOrderStatus;
    changedByUserId: string | null;
    note?: string;
    shipmentUpdate?: {
      status?: ShipmentStatus;
      shippedAt?: Date | null;
      deliveredAt?: Date | null;
    };
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subOrder.updateMany({
        where: {
          id: input.subOrderId,
          status: { in: input.fromStatuses },
        },
        data: { status: input.toStatus },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'Sub-order status was changed concurrently or transition is invalid',
        );
      }

      await tx.orderStatusHistory.create({
        data: {
          subOrderId: input.subOrderId,
          status: input.toStatus,
          changedByUserId: input.changedByUserId,
          note: input.note ?? null,
        },
      });

      if (input.shipmentUpdate) {
        await tx.shipment.updateMany({
          where: { subOrderId: input.subOrderId },
          data: {
            ...(input.shipmentUpdate.status
              ? { status: input.shipmentUpdate.status }
              : {}),
            ...(input.shipmentUpdate.shippedAt !== undefined
              ? { shippedAt: input.shipmentUpdate.shippedAt }
              : {}),
            ...(input.shipmentUpdate.deliveredAt !== undefined
              ? { deliveredAt: input.shipmentUpdate.deliveredAt }
              : {}),
            lastUpdatedBy: input.changedByUserId,
          },
        });
      }

      const subOrder = await tx.subOrder.findUniqueOrThrow({
        where: { id: input.subOrderId },
        select: { orderId: true },
      });

      return subOrder.orderId;
    });
  }

  async recomputeParentOrderStatus(orderId: string) {
    const subOrders = await this.prisma.subOrder.findMany({
      where: { orderId },
      select: { status: true },
    });

    const status = aggregateParentOrderStatus(subOrders.map((s) => s.status));

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status },
      select: ORDER_DETAIL_SELECT,
    });
  }

  updateShipment(
    subOrderId: string,
    data: {
      trackingNumber?: string;
      courierName?: string;
      shippingLabelUrl?: string;
      estimatedDelivery?: Date | null;
      status?: ShipmentStatus;
      lastUpdatedBy: string;
    },
  ) {
    return this.prisma.shipment.update({
      where: { subOrderId },
      data: {
        ...(data.trackingNumber !== undefined
          ? { trackingNumber: data.trackingNumber }
          : {}),
        ...(data.courierName !== undefined
          ? { courierName: data.courierName }
          : {}),
        ...(data.shippingLabelUrl !== undefined
          ? { shippingLabelUrl: data.shippingLabelUrl }
          : {}),
        ...(data.estimatedDelivery !== undefined
          ? { estimatedDelivery: data.estimatedDelivery }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        lastUpdatedBy: data.lastUpdatedBy,
      },
    });
  }

  async adminUpdateOrderStatus(
    orderId: string,
    status: OrderStatus,
    note: string | undefined,
    changedByUserId: string,
  ) {
    if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) {
      throw new BadRequestException(
        'Use cancel/refund endpoints for CANCELLED or REFUNDED status',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { id: true, subOrders: { select: { id: true, status: true } } },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status },
      });

      // Map parent status loosely onto sub-orders when admin forces parent
      const subStatus =
        status === OrderStatus.DELIVERED
          ? SubOrderStatus.DELIVERED
          : status === OrderStatus.SHIPPED ||
              status === OrderStatus.PARTIALLY_SHIPPED
            ? SubOrderStatus.SHIPPED
            : status === OrderStatus.PENDING_PAYMENT
              ? SubOrderStatus.PENDING
              : SubOrderStatus.CONFIRMED;

      for (const so of order.subOrders) {
        if (so.status === subStatus) continue;
        await tx.subOrder.update({
          where: { id: so.id },
          data: { status: subStatus },
        });
        await tx.orderStatusHistory.create({
          data: {
            subOrderId: so.id,
            status: subStatus,
            changedByUserId,
            note: note ?? `Admin set parent order to ${status}`,
          },
        });
      }

      return tx.order.findFirstOrThrow({
        where: { id: orderId },
        select: ORDER_DETAIL_SELECT,
      });
    });
  }

  async findSubOrderForCancelRefund(subOrderId: string) {
    return this.prisma.subOrder.findFirst({
      where: { id: subOrderId, order: { deletedAt: null } },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        status: true,
        total: true,
        subtotal: true,
        discountAmount: true,
        shippingCharge: true,
        onlineMerchandiseAmount: true,
        onlineShippingAmount: true,
        offlineMerchandiseAmount: true,
        vendorEarning: true,
        walletCreditedAt: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            cancelledQuantity: true,
            total: true,
          },
        },
        deliveries: {
          select: {
            id: true,
            status: true,
            items: {
              select: { orderItemId: true, quantity: true },
            },
          },
        },
        order: {
          select: {
            id: true,
            userId: true,
            paymentMethod: true,
            paymentStatus: true,
            razorpayPaymentId: true,
            status: true,
            createdAt: true,
            onlineAmount: true,
          },
        },
      },
    });
  }

  async sumCompletedRefunds(orderId: string) {
    const result = await this.prisma.orderRefund.aggregate({
      where: {
        orderId,
        status: {
          in: [OrderRefundStatus.COMPLETED, OrderRefundStatus.PROCESSING],
        },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  findCompletedRefundForSubOrder(subOrderId: string) {
    return this.prisma.orderRefund.findFirst({
      where: {
        subOrderId,
        status: {
          in: [OrderRefundStatus.COMPLETED, OrderRefundStatus.PROCESSING],
        },
      },
      select: { id: true, razorpayRefundId: true, status: true },
    });
  }

  /**
   * Cancels remaining not-yet-DELIVERED quantity: restock those units,
   * cancel open deliveries, optionally record a Razorpay refund.
   * Delivered qty and recorded offline cash are left intact.
   */
  async applySubOrderCancelOrRefund(input: {
    subOrderId: string;
    actorUserId: string | null;
    actorRole: PlatformRole | null;
    reason: string;
    targetStatus: SubOrderStatus;
    restock: boolean;
    clawbackWallet: boolean;
    createRefund: boolean;
    refundAmount?: Prisma.Decimal;
    razorpayRefundId?: string | null;
    providerPayload?: Prisma.InputJsonValue;
    refundStatus?: OrderRefundStatus;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.subOrder.findFirst({
        where: { id: input.subOrderId, order: { deletedAt: null } },
        select: {
          id: true,
          orderId: true,
          vendorId: true,
          status: true,
          total: true,
          vendorEarning: true,
          walletCreditedAt: true,
          items: {
            select: {
              id: true,
              variantId: true,
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
            select: { paymentStatus: true, paymentMethod: true },
          },
        },
      });
      if (!so) {
        throw new NotFoundException('Sub-order not found');
      }
      if (
        so.status === SubOrderStatus.CANCELLED ||
        so.status === SubOrderStatus.REFUNDED
      ) {
        throw new ConflictException('Sub-order already cancelled or refunded');
      }

      const deliveredByItem = new Map<string, number>();
      for (const delivery of so.deliveries) {
        if (delivery.status !== DeliveryStatus.DELIVERED) {
          continue;
        }
        for (const line of delivery.items) {
          deliveredByItem.set(
            line.orderItemId,
            (deliveredByItem.get(line.orderItemId) ?? 0) + line.quantity,
          );
        }
      }

      const restockLines: Array<{ variantId: string; quantity: number }> = [];
      for (const item of so.items) {
        const delivered = deliveredByItem.get(item.id) ?? 0;
        const remaining = item.quantity - item.cancelledQuantity - delivered;
        if (remaining > 0) {
          restockLines.push({ variantId: item.variantId, quantity: remaining });
          await tx.orderItem.update({
            where: { id: item.id },
            data: { cancelledQuantity: { increment: remaining } },
          });
        }
      }

      for (const delivery of so.deliveries) {
        if (
          delivery.status !== DeliveryStatus.DELIVERED &&
          delivery.status !== DeliveryStatus.CANCELLED
        ) {
          await tx.delivery.update({
            where: { id: delivery.id },
            data: { status: DeliveryStatus.CANCELLED },
          });
        }
      }

      let refundId: string | undefined;
      if (input.createRefund) {
        const refund = await tx.orderRefund.create({
          data: {
            orderId: so.orderId,
            subOrderId: so.id,
            amount: input.refundAmount ?? so.total,
            status: input.refundStatus ?? OrderRefundStatus.COMPLETED,
            reason: input.reason,
            initiatedByUserId: input.actorUserId,
            razorpayRefundId: input.razorpayRefundId ?? null,
            providerPayload: input.providerPayload ?? undefined,
          },
          select: { id: true },
        });
        refundId = refund.id;
      }

      let restockStatus: RestockStatus = RestockStatus.NOT_REQUIRED;
      if (input.restock) {
        for (const line of restockLines) {
          await tx.productInventory.updateMany({
            where: { variantId: line.variantId },
            data: { quantity: { increment: line.quantity } },
          });
        }
        restockStatus = RestockStatus.COMPLETED;
      }

      if (input.clawbackWallet && so.walletCreditedAt) {
        await this.clawbackWalletForSubOrder(tx, so);
      }

      const refreshed = await tx.subOrder.findUniqueOrThrow({
        where: { id: so.id },
        select: {
          status: true,
          items: {
            select: { quantity: true, cancelledQuantity: true },
          },
          deliveries: {
            select: {
              status: true,
              items: { select: { quantity: true } },
            },
          },
        },
      });
      const derived =
        input.targetStatus === SubOrderStatus.REFUNDED
          ? SubOrderStatus.REFUNDED
          : deriveSubOrderStatusFromQty({
              status: refreshed.status,
              orderedQty: refreshed.items.reduce((s, i) => s + i.quantity, 0),
              cancelledQty: refreshed.items.reduce(
                (s, i) => s + i.cancelledQuantity,
                0,
              ),
              deliveredQty: refreshed.deliveries
                .filter((d) => d.status === DeliveryStatus.DELIVERED)
                .reduce(
                  (s, d) =>
                    s + d.items.reduce((line, i) => line + i.quantity, 0),
                  0,
                ),
              dispatchedQty: refreshed.deliveries
                .filter(
                  (d) =>
                    d.status === DeliveryStatus.SHIPPED ||
                    d.status === DeliveryStatus.OUT_FOR_DELIVERY ||
                    d.status === DeliveryStatus.DELIVERED,
                )
                .reduce(
                  (s, d) =>
                    s + d.items.reduce((line, i) => line + i.quantity, 0),
                  0,
                ),
              allocatedQty: refreshed.deliveries
                .filter((d) => d.status !== DeliveryStatus.CANCELLED)
                .reduce(
                  (s, d) =>
                    s + d.items.reduce((line, i) => line + i.quantity, 0),
                  0,
                ),
            });

      await tx.subOrder.update({
        where: { id: so.id },
        data: { status: derived },
      });

      await tx.orderStatusHistory.create({
        data: {
          subOrderId: so.id,
          status: derived,
          changedByUserId: input.actorUserId,
          note: input.reason,
        },
      });

      await tx.orderCancellation.create({
        data: {
          orderId: so.orderId,
          subOrderId: so.id,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          reason: input.reason,
          restockStatus,
          refundId: refundId ?? null,
        },
      });

      const siblings = await tx.subOrder.findMany({
        where: { orderId: so.orderId },
        select: {
          status: true,
          items: {
            select: { quantity: true, cancelledQuantity: true },
          },
          deliveries: {
            select: {
              status: true,
              items: { select: { quantity: true } },
            },
          },
        },
      });
      const parentStatus = aggregateParentOrderStatusFromQty(
        siblings.map((sibling) => ({
          status: sibling.status,
          orderedQty: sibling.items.reduce((s, i) => s + i.quantity, 0),
          cancelledQty: sibling.items.reduce(
            (s, i) => s + i.cancelledQuantity,
            0,
          ),
          deliveredQty: sibling.deliveries
            .filter((d) => d.status === DeliveryStatus.DELIVERED)
            .reduce(
              (s, d) => s + d.items.reduce((line, i) => line + i.quantity, 0),
              0,
            ),
          dispatchedQty: sibling.deliveries
            .filter(
              (d) =>
                d.status === DeliveryStatus.SHIPPED ||
                d.status === DeliveryStatus.OUT_FOR_DELIVERY ||
                d.status === DeliveryStatus.DELIVERED,
            )
            .reduce(
              (s, d) => s + d.items.reduce((line, i) => line + i.quantity, 0),
              0,
            ),
          allocatedQty: sibling.deliveries
            .filter((d) => d.status !== DeliveryStatus.CANCELLED)
            .reduce(
              (s, d) => s + d.items.reduce((line, i) => line + i.quantity, 0),
              0,
            ),
        })),
      );

      const paymentUpdate: {
        status: OrderStatus;
        paymentStatus?: PaymentStatus;
        paymentTimeoutJobId?: null;
      } = { status: parentStatus };

      if (siblings.every((s) => s.status === SubOrderStatus.CANCELLED)) {
        const captured =
          so.order.paymentStatus === PaymentStatus.PAID ||
          so.order.paymentStatus === PaymentStatus.PARTIALLY_PAID;
        paymentUpdate.paymentStatus = captured
          ? PaymentStatus.REFUNDED
          : PaymentStatus.FAILED;
        paymentUpdate.paymentTimeoutJobId = null;
      } else if (siblings.every((s) => s.status === SubOrderStatus.REFUNDED)) {
        paymentUpdate.paymentStatus = PaymentStatus.REFUNDED;
      } else if (
        siblings.some((s) => s.status === SubOrderStatus.REFUNDED) &&
        !siblings.some(
          (s) =>
            s.status !== SubOrderStatus.CANCELLED &&
            s.status !== SubOrderStatus.REFUNDED,
        )
      ) {
        paymentUpdate.paymentStatus = PaymentStatus.REFUNDED;
      }

      await tx.order.update({
        where: { id: so.orderId },
        data: paymentUpdate,
      });

      if (
        so.order.paymentStatus === PaymentStatus.PENDING &&
        parentStatus === OrderStatus.CANCELLED
      ) {
        await this.releaseCouponUsagesForOrder(tx, so.orderId);
      }

      return {
        orderId: so.orderId,
        subOrderId: so.id,
        refundId: refundId ?? null,
        vendorId: so.vendorId,
      };
    });
  }

  private async clawbackWalletForSubOrder(
    tx: Prisma.TransactionClient,
    so: {
      id: string;
      vendorId: string;
      vendorEarning: Prisma.Decimal;
      walletCreditedAt: Date | null;
    },
  ) {
    const existing = await tx.vendorTransaction.findFirst({
      where: {
        reason: TransactionReason.REFUND_DEDUCTION,
        referenceType: 'SUB_ORDER',
        referenceId: so.id,
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const wallet = await tx.vendorWallet.upsert({
      where: { vendorId: so.vendorId },
      update: {},
      create: { vendorId: so.vendorId },
      select: { id: true, balance: true },
    });

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore.sub(so.vendorEarning);

    await tx.vendorWallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });

    await tx.vendorTransaction.create({
      data: {
        vendorId: so.vendorId,
        walletId: wallet.id,
        type: TransactionType.DEBIT,
        reason: TransactionReason.REFUND_DEDUCTION,
        amount: so.vendorEarning,
        balanceBefore,
        balanceAfter,
        referenceId: so.id,
        referenceType: 'SUB_ORDER',
        note: 'Refund clawback',
      },
    });
  }

  async markRefundFailed(input: {
    orderId: string;
    subOrderId: string;
    actorUserId: string | null;
    amount: Prisma.Decimal;
    reason: string;
    providerPayload?: Prisma.InputJsonValue;
  }) {
    return this.prisma.orderRefund.create({
      data: {
        orderId: input.orderId,
        subOrderId: input.subOrderId,
        amount: input.amount,
        status: OrderRefundStatus.FAILED,
        reason: input.reason,
        initiatedByUserId: input.actorUserId,
        providerPayload: input.providerPayload ?? undefined,
      },
      select: { id: true, status: true },
    });
  }

  async cancelTimedOutOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          deletedAt: null,
          status: OrderStatus.PENDING_PAYMENT,
          paymentStatus: PaymentStatus.PENDING,
        },
        select: {
          id: true,
          userId: true,
          subOrders: {
            select: {
              id: true,
              status: true,
              items: { select: { variantId: true, quantity: true } },
            },
          },
        },
      });

      if (!order) {
        return null;
      }

      for (const so of order.subOrders) {
        if (
          so.status === SubOrderStatus.CANCELLED ||
          so.status === SubOrderStatus.REFUNDED
        ) {
          continue;
        }

        for (const item of so.items) {
          await tx.productInventory.updateMany({
            where: { variantId: item.variantId },
            data: { quantity: { increment: item.quantity } },
          });
        }

        await tx.subOrder.update({
          where: { id: so.id },
          data: { status: SubOrderStatus.CANCELLED },
        });
        await tx.orderStatusHistory.create({
          data: {
            subOrderId: so.id,
            status: SubOrderStatus.CANCELLED,
            note: 'Payment timeout',
          },
        });
        await tx.orderCancellation.create({
          data: {
            orderId: order.id,
            subOrderId: so.id,
            actorUserId: null,
            actorRole: null,
            reason: 'Payment timeout',
            restockStatus: RestockStatus.COMPLETED,
          },
        });
      }

      await this.releaseCouponUsagesForOrder(tx, order.id);

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.FAILED,
          paymentTimeoutJobId: null,
        },
      });

      return { orderId: order.id, userId: order.userId };
    });
  }

  private releaseCouponUsagesForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    return tx.couponUsage.deleteMany({ where: { orderId } });
  }

  async captureOnlinePayment(input: {
    orderId: string;
    razorpayPaymentId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: input.orderId, deletedAt: null },
        select: {
          id: true,
          paymentMethod: true,
          paymentStatus: true,
          paymentTimeoutJobId: true,
          subOrders: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (
        order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_PAID
      ) {
        return {
          alreadyPaid: true as const,
          orderId: order.id,
          paymentTimeoutJobId: order.paymentTimeoutJobId,
        };
      }

      const nextPaymentStatus =
        order.paymentMethod === PaymentMethod.COD
          ? PaymentStatus.PARTIALLY_PAID
          : PaymentStatus.PAID;

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: nextPaymentStatus,
          status: OrderStatus.CONFIRMED,
          razorpayPaymentId: input.razorpayPaymentId,
          paymentTimeoutJobId: null,
        },
      });

      for (const so of order.subOrders) {
        if (so.status === SubOrderStatus.PENDING) {
          await tx.subOrder.update({
            where: { id: so.id },
            data: { status: SubOrderStatus.CONFIRMED },
          });
          await tx.orderStatusHistory.create({
            data: {
              subOrderId: so.id,
              status: SubOrderStatus.CONFIRMED,
              note: 'Payment captured',
            },
          });
        }
      }

      return {
        alreadyPaid: false as const,
        orderId: order.id,
        paymentTimeoutJobId: order.paymentTimeoutJobId,
      };
    });
  }

  async creditWalletForSubOrderId(subOrderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.subOrder.findUnique({
        where: { id: subOrderId },
        select: {
          id: true,
          vendorId: true,
          vendorEarning: true,
          walletCreditedAt: true,
        },
      });
      if (!so) {
        throw new NotFoundException('Sub-order not found');
      }
      await this.creditWalletForSubOrder(tx, so);
    });
  }

  private async creditWalletForSubOrder(
    tx: Prisma.TransactionClient,
    so: {
      id: string;
      vendorId: string;
      vendorEarning: Prisma.Decimal;
      walletCreditedAt: Date | null;
    },
  ) {
    if (so.walletCreditedAt) {
      return;
    }

    const existingTx = await tx.vendorTransaction.findFirst({
      where: {
        reason: TransactionReason.ORDER_EARNING,
        referenceType: 'SUB_ORDER',
        referenceId: so.id,
      },
      select: { id: true },
    });
    if (existingTx) {
      return;
    }

    const wallet = await tx.vendorWallet.upsert({
      where: { vendorId: so.vendorId },
      update: {},
      create: { vendorId: so.vendorId },
      select: { id: true, balance: true, totalEarned: true },
    });

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore.add(so.vendorEarning);

    await tx.vendorWallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        totalEarned: wallet.totalEarned.add(so.vendorEarning),
      },
    });

    await tx.vendorTransaction.create({
      data: {
        vendorId: so.vendorId,
        walletId: wallet.id,
        type: TransactionType.CREDIT,
        reason: TransactionReason.ORDER_EARNING,
        amount: so.vendorEarning,
        balanceBefore,
        balanceAfter,
        referenceId: so.id,
        referenceType: 'SUB_ORDER',
        note: 'Order earning',
      },
    });

    await tx.subOrder.update({
      where: { id: so.id },
      data: { walletCreditedAt: new Date() },
    });
  }

  resolveCommissionRate(vendorRate: Prisma.Decimal | null): Prisma.Decimal {
    return vendorRate ?? DEFAULT_PLATFORM_COMMISSION_RATE;
  }

  assertCheckoutCartValid(
    cart: NonNullable<
      Awaited<ReturnType<OrdersRepository['findCartWithShippingData']>>
    >,
    visibleCategoryIds: Set<string>,
    options?: { requireVendorShipping?: boolean },
  ) {
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const requireVendorShipping = options?.requireVendorShipping ?? true;

    for (const item of cart.items) {
      const v = item.variant;
      if (
        !v.isActive ||
        v.deletedAt ||
        v.product.deletedAt ||
        v.product.status !== ProductStatus.ACTIVE ||
        !v.product.vendor.isApproved ||
        v.product.vendor.deletedAt ||
        !visibleCategoryIds.has(v.product.categoryId) ||
        (v.product.brandId !== null && !v.product.brand?.isActive)
      ) {
        throw new ConflictException(`Variant ${v.sku} is no longer available`);
      }
      if (
        v.inventory &&
        !v.inventory.allowBackorder &&
        item.quantity > v.inventory.quantity
      ) {
        throw new ConflictException(`Insufficient stock for ${v.sku}`);
      }
      if (requireVendorShipping) {
        if (
          !v.product.vendor.shippingMethod ||
          !v.product.vendor.shippingMethod.isActive
        ) {
          if (!v.product.shippingOverride) {
            throw new ConflictException(
              `Vendor ${v.product.vendor.businessName} has no shipping method`,
            );
          }
        }
      }
    }
  }
}
