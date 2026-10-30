import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  MediaContext,
  MediaEntityType,
  MediaOwnerType,
  OrderRefundStatus,
  Prisma,
  ReturnStatus,
  TransactionReason,
  TransactionType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { roundMoney } from '../../common/utils/money.util';

const RETURN_CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
} as const;

const RETURN_VENDOR_SELECT = {
  id: true,
  businessName: true,
  slug: true,
} as const;

const RETURN_ITEM_SELECT = {
  id: true,
  orderItemId: true,
  deliveryItemId: true,
  quantity: true,
  orderItem: {
    select: {
      variantId: true,
      productName: true,
      variantName: true,
      sku: true,
      unitPrice: true,
      unitSymbol: true,
      imageUrlSnapshot: true,
    },
  },
} as const;

const RETURN_CORE_SELECT = {
  id: true,
  orderId: true,
  subOrderId: true,
  deliveryId: true,
  userId: true,
  vendorId: true,
  status: true,
  reasonCode: true,
  details: true,
  vendorReviewNote: true,
  adminOverrideReason: true,
  reviewedByUserId: true,
  receivedAt: true,
  inspectionNotes: true,
  onlineRefundAmount: true,
  offlineRefundAmount: true,
  offlineRefundConfirmedAt: true,
  createdAt: true,
  updatedAt: true,
  items: { select: RETURN_ITEM_SELECT },
  user: { select: RETURN_CUSTOMER_SELECT },
  vendor: { select: RETURN_VENDOR_SELECT },
} as const;

const RETURN_LIST_SELECT = {
  ...RETURN_CORE_SELECT,
  order: {
    select: {
      id: true,
      orderNumber: true,
      paymentMethod: true,
    },
  },
  subOrder: {
    select: {
      id: true,
      subOrderNumber: true,
      onlineMerchandiseAmount: true,
      offlineMerchandiseAmount: true,
    },
  },
} as const;

const RETURN_DETAIL_SELECT = {
  ...RETURN_CORE_SELECT,
  order: {
    select: {
      id: true,
      orderNumber: true,
      fulfillmentStage: true,
      fulfillmentSummary: true,
      paymentMethod: true,
      paymentStatus: true,
      razorpayPaymentId: true,
      onlineAmount: true,
      addressLabel: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressPincode: true,
      addressPhone: true,
      addressLatitude: true,
      addressLongitude: true,
    },
  },
  delivery: {
    select: {
      id: true,
      deliveryNumber: true,
      status: true,
      deliveredAt: true,
      walletCreditAmount: true,
      walletCreditedAt: true,
      offlineAmountCollected: true,
      items: {
        select: { id: true, orderItemId: true, quantity: true },
      },
    },
  },
  subOrder: {
    select: {
      id: true,
      subOrderNumber: true,
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
          variantId: true,
        },
      },
    },
  },
  refunds: {
    select: {
      id: true,
      amount: true,
      status: true,
      razorpayRefundId: true,
    },
  },
} as const;

@Injectable()
export class ReturnsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.returnRequest.findUnique({
      where: { id },
      select: RETURN_DETAIL_SELECT,
    });
  }

  listForCustomer(userId: string) {
    return this.prisma.returnRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: RETURN_LIST_SELECT,
    });
  }

  listForVendor(vendorId: string) {
    return this.prisma.returnRequest.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      select: RETURN_LIST_SELECT,
    });
  }

  listForAdmin() {
    return this.prisma.returnRequest.findMany({
      orderBy: { createdAt: 'desc' },
      select: RETURN_LIST_SELECT,
    });
  }

  findDeliveryForReturn(deliveryId: string) {
    return this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        deliveredAt: true,
        subOrderId: true,
        walletCreditAmount: true,
        items: {
          select: { id: true, orderItemId: true, quantity: true },
        },
        subOrder: {
          select: {
            id: true,
            orderId: true,
            vendorId: true,
            order: { select: { id: true, userId: true } },
          },
        },
        returnRequests: {
          select: {
            status: true,
            items: {
              select: { deliveryItemId: true, quantity: true },
            },
          },
        },
      },
    });
  }

  returnedQtyByDeliveryItem(
    requests: Array<{
      status: ReturnStatus;
      items: Array<{ deliveryItemId: string; quantity: number }>;
    }>,
  ) {
    const map = new Map<string, number>();
    for (const request of requests) {
      if (request.status === ReturnStatus.REJECTED) {
        continue;
      }
      for (const item of request.items) {
        map.set(
          item.deliveryItemId,
          (map.get(item.deliveryItemId) ?? 0) + item.quantity,
        );
      }
    }
    return map;
  }

  async createRequest(input: {
    orderId: string;
    subOrderId: string;
    deliveryId: string;
    userId: string;
    vendorId: string;
    reasonCode: Prisma.ReturnRequestCreateInput['reasonCode'];
    details?: string;
    items: Array<{
      orderItemId: string;
      deliveryItemId: string;
      quantity: number;
    }>;
    mediaIds?: string[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.returnRequest.create({
        data: {
          orderId: input.orderId,
          subOrderId: input.subOrderId,
          deliveryId: input.deliveryId,
          userId: input.userId,
          vendorId: input.vendorId,
          reasonCode: input.reasonCode,
          details: input.details ?? null,
          items: { create: input.items },
        },
        select: { id: true },
      });

      if (input.mediaIds?.length) {
        const media = await tx.media.findMany({
          where: {
            id: { in: input.mediaIds },
            ownerType: MediaOwnerType.USER,
            ownerId: input.userId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (media.length !== input.mediaIds.length) {
          throw new NotFoundException(
            'One or more media records were not found',
          );
        }
        await Promise.all(
          input.mediaIds.map((mediaId, index) =>
            tx.mediaLink.create({
              data: {
                mediaId,
                entityType: MediaEntityType.RETURN_REQUEST,
                entityId: created.id,
                context: MediaContext.RETURN_EVIDENCE,
                sortOrder: index,
                isPrimary: index === 0,
              },
            }),
          ),
        );
      }

      return created;
    });
  }

  async updateStatus(input: {
    id: string;
    from: ReturnStatus[];
    status: ReturnStatus;
    vendorReviewNote?: string;
    adminOverrideReason?: string;
    reviewedByUserId?: string;
    receivedAt?: Date;
    inspectionNotes?: string;
    onlineRefundAmount?: Prisma.Decimal;
    offlineRefundAmount?: Prisma.Decimal;
    offlineRefundConfirmedAt?: Date;
  }) {
    const updated = await this.prisma.returnRequest.updateMany({
      where: { id: input.id, status: { in: input.from } },
      data: {
        status: input.status,
        ...(input.vendorReviewNote !== undefined
          ? { vendorReviewNote: input.vendorReviewNote }
          : {}),
        ...(input.adminOverrideReason !== undefined
          ? { adminOverrideReason: input.adminOverrideReason }
          : {}),
        ...(input.reviewedByUserId !== undefined
          ? { reviewedByUserId: input.reviewedByUserId }
          : {}),
        ...(input.receivedAt !== undefined
          ? { receivedAt: input.receivedAt }
          : {}),
        ...(input.inspectionNotes !== undefined
          ? { inspectionNotes: input.inspectionNotes }
          : {}),
        ...(input.onlineRefundAmount !== undefined
          ? { onlineRefundAmount: input.onlineRefundAmount }
          : {}),
        ...(input.offlineRefundAmount !== undefined
          ? { offlineRefundAmount: input.offlineRefundAmount }
          : {}),
        ...(input.offlineRefundConfirmedAt !== undefined
          ? { offlineRefundConfirmedAt: input.offlineRefundConfirmedAt }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Return request status was already changed');
    }
    return this.findById(input.id);
  }

  async restockAndClawback(input: {
    returnId: string;
    vendorId: string;
    restock: Array<{ variantId: string; quantity: number }>;
    walletClawback: Prisma.Decimal;
  }) {
    return this.prisma.$transaction(async (tx) => {
      for (const line of input.restock) {
        await tx.productInventory.updateMany({
          where: { variantId: line.variantId },
          data: { quantity: { increment: line.quantity } },
        });
      }

      if (input.walletClawback.lessThanOrEqualTo(0)) {
        return;
      }

      const existing = await tx.vendorTransaction.findFirst({
        where: {
          reason: TransactionReason.REFUND_DEDUCTION,
          referenceType: 'RETURN',
          referenceId: input.returnId,
        },
        select: { id: true },
      });
      if (existing) {
        return;
      }

      const wallet = await tx.vendorWallet.upsert({
        where: { vendorId: input.vendorId },
        update: {},
        create: { vendorId: input.vendorId },
        select: { id: true, balance: true },
      });
      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore.sub(input.walletClawback);
      await tx.vendorWallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter },
      });
      await tx.vendorTransaction.create({
        data: {
          vendorId: input.vendorId,
          walletId: wallet.id,
          type: TransactionType.DEBIT,
          reason: TransactionReason.REFUND_DEDUCTION,
          amount: input.walletClawback,
          balanceBefore,
          balanceAfter,
          referenceId: input.returnId,
          referenceType: 'RETURN',
          note: 'Return clawback',
        },
      });
    });
  }

  async createOnlineRefund(input: {
    orderId: string;
    subOrderId: string;
    returnRequestId: string;
    actorUserId: string | null;
    amount: Prisma.Decimal;
    razorpayRefundId: string | null;
    providerPayload?: Prisma.InputJsonValue;
    status: OrderRefundStatus;
    reason: string;
  }) {
    return this.prisma.orderRefund.create({
      data: {
        orderId: input.orderId,
        subOrderId: input.subOrderId,
        returnRequestId: input.returnRequestId,
        amount: input.amount,
        status: input.status,
        reason: input.reason,
        initiatedByUserId: input.actorUserId,
        razorpayRefundId: input.razorpayRefundId,
        providerPayload: input.providerPayload,
      },
      select: { id: true, status: true, razorpayRefundId: true },
    });
  }

  sumCompletedRefunds(orderId: string) {
    return this.prisma.orderRefund.aggregate({
      where: {
        orderId,
        status: {
          in: [OrderRefundStatus.COMPLETED, OrderRefundStatus.PROCESSING],
        },
      },
      _sum: { amount: true },
    });
  }

  requireDelivered(status: DeliveryStatus) {
    return status === DeliveryStatus.DELIVERED;
  }

  roundShare(
    part: Prisma.Decimal,
    whole: Prisma.Decimal,
    total: Prisma.Decimal,
  ) {
    if (whole.lessThanOrEqualTo(0)) {
      return new Prisma.Decimal(0);
    }
    return roundMoney(part.div(whole).mul(total));
  }
}
