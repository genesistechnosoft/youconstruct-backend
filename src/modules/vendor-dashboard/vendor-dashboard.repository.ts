import { Injectable } from '@nestjs/common';
import {
  PayoutStatus,
  Prisma,
  ProductStatus,
  SubOrderStatus,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

const PENDING_VENDOR_ACTION: SubOrderStatus[] = [
  SubOrderStatus.PENDING,
  SubOrderStatus.CONFIRMED,
  SubOrderStatus.PROCESSING,
];

const SALES_EXCLUDED: SubOrderStatus[] = [
  SubOrderStatus.CANCELLED,
  SubOrderStatus.REFUNDED,
];

@Injectable()
export class VendorDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findApprovedVendor(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: {
        id: vendorId,
        deletedAt: null,
        isApproved: true,
        onboardingStatus: VendorOnboardingStatus.APPROVED,
      },
      select: {
        id: true,
        businessName: true,
        slug: true,
        bio: true,
        city: true,
        state: true,
        pincode: true,
        approvedAt: true,
        createdAt: true,
        storeSettings: {
          select: {
            shippingPolicy: true,
            refundPolicy: true,
            cancellationPolicy: true,
            supportPhone: true,
            supportEmail: true,
            seoTitle: true,
            seoDescription: true,
            socialInstagram: true,
            socialFacebook: true,
            socialYoutube: true,
          },
        },
        membership: {
          select: {
            productLimit: true,
            storageLimitMb: true,
            storageUsedMb: true,
            plan: true,
          },
        },
        shippingMethod: {
          select: { id: true, isActive: true },
        },
        wallet: {
          select: {
            balance: true,
            lockedBalance: true,
            totalEarned: true,
            totalWithdrawn: true,
          },
        },
      },
    });
  }

  async findPublicList(filters: {
    search?: string;
    city?: string;
    state?: string;
    page?: number;
    limit?: number;
  }) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.VendorProfileWhereInput = {
      deletedAt: null,
      isApproved: true,
      onboardingStatus: VendorOnboardingStatus.APPROVED,
      slug: { not: null },
      ...(filters.search && {
        businessName: { contains: filters.search, mode: 'insensitive' },
      }),
      ...(filters.city && {
        city: { equals: filters.city, mode: 'insensitive' },
      }),
      ...(filters.state && {
        state: { equals: filters.state, mode: 'insensitive' },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vendorProfile.findMany({
        where,
        skip,
        take,
        orderBy: [{ approvedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          businessName: true,
          slug: true,
          bio: true,
          city: true,
          state: true,
        },
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);

    return { items, total };
  }

  async countActiveProductsByVendors(vendorIds: string[]) {
    const counts = new Map<string, number>();
    if (vendorIds.length === 0) {
      return counts;
    }

    const rows = await this.prisma.product.groupBy({
      by: ['vendorId'],
      where: {
        vendorId: { in: vendorIds },
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
      _count: { _all: true },
    });

    for (const row of rows) {
      counts.set(row.vendorId, row._count._all);
    }

    return counts;
  }

  findPublicBySlug(slug: string) {
    return this.prisma.vendorProfile.findFirst({
      where: {
        slug,
        deletedAt: null,
        isApproved: true,
        onboardingStatus: VendorOnboardingStatus.APPROVED,
      },
      select: {
        id: true,
        businessName: true,
        slug: true,
        bio: true,
        about: true,
        city: true,
        state: true,
        pincode: true,
        approvedAt: true,
        createdAt: true,
        storeSettings: {
          select: {
            shippingPolicy: true,
            refundPolicy: true,
            cancellationPolicy: true,
            supportPhone: true,
            supportEmail: true,
            seoTitle: true,
            seoDescription: true,
            socialInstagram: true,
            socialFacebook: true,
            socialYoutube: true,
          },
        },
      },
    });
  }

  countPendingOrders(vendorId: string) {
    return this.prisma.subOrder.count({
      where: {
        vendorId,
        status: { in: PENDING_VENDOR_ACTION },
        order: { deletedAt: null },
      },
    });
  }

  findRecentOrders(vendorId: string, take = 5) {
    return this.prisma.subOrder.findMany({
      where: {
        vendorId,
        order: { deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        subOrderNumber: true,
        status: true,
        total: true,
        createdAt: true,
        order: {
          select: {
            orderNumber: true,
            paymentStatus: true,
            paymentMethod: true,
          },
        },
      },
    });
  }

  async salesInRange(vendorId: string, from: Date, to: Date) {
    const aggregate = await this.prisma.subOrder.aggregate({
      where: {
        vendorId,
        createdAt: { gte: from, lte: to },
        status: { notIn: SALES_EXCLUDED },
        order: { deletedAt: null },
      },
      _sum: { total: true },
      _count: { _all: true },
    });

    return {
      total: aggregate._sum.total ?? new Prisma.Decimal(0),
      count: aggregate._count._all,
    };
  }

  countLowStockVariants(vendorId: string) {
    return this.prisma.productInventory
      .findMany({
        where: {
          variant: {
            deletedAt: null,
            isActive: true,
            product: {
              vendorId,
              deletedAt: null,
              status: { in: [ProductStatus.ACTIVE, ProductStatus.INACTIVE] },
            },
          },
        },
        select: {
          quantity: true,
          lowStockThreshold: true,
        },
      })
      .then(
        (rows) =>
          rows.filter((row) => row.quantity <= row.lowStockThreshold).length,
      );
  }

  countActiveProducts(vendorId: string) {
    return this.prisma.product.count({
      where: {
        vendorId,
        deletedAt: null,
        status: ProductStatus.ACTIVE,
      },
    });
  }

  countAllProducts(vendorId: string) {
    return this.prisma.product.count({
      where: { vendorId, deletedAt: null },
    });
  }

  async topProducts(vendorId: string, from: Date, to: Date, take = 10) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        subOrder: {
          vendorId,
          createdAt: { gte: from, lte: to },
          status: { notIn: SALES_EXCLUDED },
          order: { deletedAt: null },
        },
      },
      select: {
        productName: true,
        sku: true,
        quantity: true,
        total: true,
        variantId: true,
      },
    });

    const map = new Map<
      string,
      {
        variantId: string;
        productName: string;
        sku: string;
        quantity: number;
        revenue: Prisma.Decimal;
      }
    >();

    for (const item of items) {
      const existing = map.get(item.variantId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue = existing.revenue.add(item.total);
      } else {
        map.set(item.variantId, {
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          revenue: item.total,
        });
      }
    }

    return [...map.values()]
      .sort((a, b) => Number(b.revenue.sub(a.revenue)))
      .slice(0, take);
  }

  countCancellations(vendorId: string, from: Date, to: Date) {
    return this.prisma.orderCancellation.count({
      where: {
        subOrder: { vendorId },
        createdAt: { gte: from, lte: to },
      },
    });
  }

  countRefunds(vendorId: string, from: Date, to: Date) {
    return this.prisma.orderRefund.count({
      where: {
        subOrder: { vendorId },
        createdAt: { gte: from, lte: to },
      },
    });
  }

  async payoutSummary(vendorId: string, from: Date, to: Date) {
    const payouts = await this.prisma.vendorPayout.findMany({
      where: {
        vendorId,
        createdAt: { gte: from, lte: to },
      },
      select: { status: true, amount: true },
    });

    let requested = new Prisma.Decimal(0);
    let completed = new Prisma.Decimal(0);
    let failed = new Prisma.Decimal(0);

    for (const payout of payouts) {
      requested = requested.add(payout.amount);
      if (payout.status === PayoutStatus.COMPLETED) {
        completed = completed.add(payout.amount);
      }
      if (payout.status === PayoutStatus.FAILED) {
        failed = failed.add(payout.amount);
      }
    }

    return { requested, completed, failed, count: payouts.length };
  }
}
