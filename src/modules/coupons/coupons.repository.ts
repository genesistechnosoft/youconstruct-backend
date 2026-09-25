import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CouponScope,
  CouponStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

export const COUPON_SELECT = {
  id: true,
  code: true,
  scope: true,
  vendorId: true,
  status: true,
  discountType: true,
  discountValue: true,
  maxDiscountAmount: true,
  minOrderAmount: true,
  usageLimit: true,
  usageLimitPerUser: true,
  startsAt: true,
  expiresAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { usages: true } },
} as const;

@Injectable()
export class CouponsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.coupon.findFirst({
      where: { id, deletedAt: null },
      select: COUPON_SELECT,
    });
  }

  findByCode(code: string) {
    return this.prisma.coupon.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
      },
      select: COUPON_SELECT,
    });
  }

  findLivePlatform(take = 50) {
    const now = new Date();
    return this.prisma.coupon.findMany({
      where: {
        deletedAt: null,
        scope: CouponScope.PLATFORM,
        status: CouponStatus.ACTIVE,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        code: true,
        discountType: true,
        discountValue: true,
        maxDiscountAmount: true,
        minOrderAmount: true,
        expiresAt: true,
        usageLimit: true,
        _count: { select: { usages: true } },
      },
    });
  }

  async list(filters: {
    scope?: CouponScope;
    vendorId?: string;
    status?: CouponStatus;
    page?: number;
    limit?: number;
  }) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const now = new Date();
    const where: Prisma.CouponWhereInput = {
      deletedAt: null,
      ...(filters.scope && { scope: filters.scope }),
      ...(filters.vendorId && { vendorId: filters.vendorId }),
      ...this.statusFilter(filters.status, now),
    };

    const [items, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: COUPON_SELECT,
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: Prisma.CouponUncheckedCreateInput) {
    try {
      return await this.prisma.coupon.create({
        data,
        select: COUPON_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.CouponUncheckedUpdateInput) {
    try {
      return await this.prisma.coupon.update({
        where: { id },
        data,
        select: COUPON_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDelete(id: string) {
    try {
      return await this.prisma.coupon.update({
        where: { id },
        data: { deletedAt: new Date(), status: CouponStatus.INACTIVE },
        select: COUPON_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countUsages(couponId: string) {
    return this.prisma.couponUsage.count({ where: { couponId } });
  }

  countUsagesForUser(couponId: string, userId: string) {
    return this.prisma.couponUsage.count({ where: { couponId, userId } });
  }

  createUsage(data: {
    couponId: string;
    userId: string;
    orderId: string;
    amount: Prisma.Decimal;
  }) {
    return this.prisma.couponUsage.create({
      data,
      select: { id: true },
    });
  }

  private statusFilter(
    status: CouponStatus | undefined,
    now: Date,
  ): Prisma.CouponWhereInput {
    if (!status) {
      return {};
    }
    if (status === CouponStatus.ACTIVE) {
      return {
        status: CouponStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
    }
    if (status === CouponStatus.EXPIRED) {
      return {
        OR: [
          { status: CouponStatus.EXPIRED },
          {
            status: CouponStatus.ACTIVE,
            expiresAt: { lte: now },
          },
        ],
      };
    }
    return { status };
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Coupon code already exists');
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Coupon not found');
    }
    throw error;
  }
}
