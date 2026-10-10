import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CouponDiscountType,
  CouponScope,
  CouponStatus,
  NotificationEventType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { allocateByShare, formatMoney } from '../../common/utils/money.util';
import { paginationMeta } from '../../common/utils/pagination.util';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import {
  CouponFiltersDto,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { CouponsRepository } from './coupons.repository';

export type CartLineForCoupon = {
  variantId?: string;
  vendorId: string;
  lineTotal: Prisma.Decimal;
};

export type CouponEvaluation = {
  couponId: string;
  code: string;
  description: string | null;
  scope: CouponScope;
  vendorId: string | null;
  eligibleSubtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
};

@Injectable()
export class CouponsService {
  constructor(
    private readonly couponsRepository: CouponsRepository,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
  ) {}

  async listPublicPlatform(limit = 10) {
    const coupons = await this.couponsRepository.findLivePlatform();
    return coupons
      .filter(
        (coupon) =>
          coupon.usageLimit == null || coupon._count.usages < coupon.usageLimit,
      )
      .slice(0, limit)
      .map((coupon) => ({
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: formatMoney(coupon.discountValue),
        maxDiscountAmount: coupon.maxDiscountAmount
          ? formatMoney(coupon.maxDiscountAmount)
          : null,
        minOrderAmount: coupon.minOrderAmount
          ? formatMoney(coupon.minOrderAmount)
          : null,
        expiresAt: coupon.expiresAt,
      }));
  }

  async listAdmin(filters: CouponFiltersDto) {
    const { items, total } = await this.couponsRepository.list({
      scope: CouponScope.PLATFORM,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    });
    return {
      message: 'Coupons fetched successfully',
      data: items.map((item) => this.serializeCoupon(item)),
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async listVendor(vendorId: string, filters: CouponFiltersDto) {
    const { items, total } = await this.couponsRepository.list({
      scope: CouponScope.VENDOR,
      vendorId,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    });
    return {
      message: 'Coupons fetched successfully',
      data: items.map((item) => this.serializeCoupon(item)),
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async getAdmin(id: string) {
    const coupon = await this.couponsRepository.findById(id);
    if (!coupon || coupon.scope !== CouponScope.PLATFORM) {
      throw new NotFoundException('Coupon not found');
    }
    return {
      message: 'Coupon fetched successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async getVendor(vendorId: string, id: string) {
    const coupon = await this.couponsRepository.findById(id);
    if (
      !coupon ||
      coupon.scope !== CouponScope.VENDOR ||
      coupon.vendorId !== vendorId
    ) {
      throw new NotFoundException('Coupon not found');
    }
    return {
      message: 'Coupon fetched successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async createPlatform(userId: string, dto: CreateCouponDto) {
    await this.assertPlatformCouponsEnabled();
    this.validateDiscountDto(dto);
    const coupon = await this.couponsRepository.create({
      code: dto.code.trim().toUpperCase(),
      description: this.normalizeDescription(dto.description),
      scope: CouponScope.PLATFORM,
      status: CouponStatus.DRAFT,
      discountType: dto.discountType,
      discountValue: new Prisma.Decimal(dto.discountValue),
      maxDiscountAmount:
        dto.maxDiscountAmount !== undefined
          ? new Prisma.Decimal(dto.maxDiscountAmount)
          : undefined,
      minOrderAmount:
        dto.minOrderAmount !== undefined
          ? new Prisma.Decimal(dto.minOrderAmount)
          : undefined,
      usageLimit: dto.usageLimit,
      usageLimitPerUser: dto.usageLimitPerUser,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdByUserId: userId,
    });
    this.notifications.emit({
      userId,
      eventType: NotificationEventType.COUPON_CREATED,
      title: 'Coupon created',
      body: `Platform coupon ${coupon.code} was created`,
      data: { couponId: coupon.id, code: coupon.code },
    });
    return {
      message: 'Coupon created successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async createVendor(vendorId: string, userId: string, dto: CreateCouponDto) {
    await this.assertVendorCouponsEnabled();
    this.validateDiscountDto(dto);
    const coupon = await this.couponsRepository.create({
      code: dto.code.trim().toUpperCase(),
      description: this.normalizeDescription(dto.description),
      scope: CouponScope.VENDOR,
      vendorId,
      status: CouponStatus.DRAFT,
      discountType: dto.discountType,
      discountValue: new Prisma.Decimal(dto.discountValue),
      maxDiscountAmount:
        dto.maxDiscountAmount !== undefined
          ? new Prisma.Decimal(dto.maxDiscountAmount)
          : undefined,
      minOrderAmount:
        dto.minOrderAmount !== undefined
          ? new Prisma.Decimal(dto.minOrderAmount)
          : undefined,
      usageLimit: dto.usageLimit,
      usageLimitPerUser: dto.usageLimitPerUser,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdByUserId: userId,
    });
    this.notifications.emit({
      userId,
      eventType: NotificationEventType.COUPON_CREATED,
      title: 'Coupon created',
      body: `Vendor coupon ${coupon.code} was created`,
      data: { couponId: coupon.id, code: coupon.code, vendorId },
    });
    return {
      message: 'Coupon created successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async updatePlatform(id: string, dto: UpdateCouponDto) {
    const existing = await this.couponsRepository.findById(id);
    if (!existing || existing.scope !== CouponScope.PLATFORM) {
      throw new NotFoundException('Coupon not found');
    }
    this.validateUpdateDiscount(existing.discountType, dto);
    const coupon = await this.couponsRepository.update(
      id,
      this.toUpdateData(dto),
    );
    return {
      message: 'Coupon updated successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async updateVendor(vendorId: string, id: string, dto: UpdateCouponDto) {
    const existing = await this.couponsRepository.findById(id);
    if (
      !existing ||
      existing.scope !== CouponScope.VENDOR ||
      existing.vendorId !== vendorId
    ) {
      throw new NotFoundException('Coupon not found');
    }
    this.validateUpdateDiscount(existing.discountType, dto);
    const coupon = await this.couponsRepository.update(
      id,
      this.toUpdateData(dto),
    );
    return {
      message: 'Coupon updated successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  async activatePlatform(id: string) {
    return this.setStatus(id, CouponScope.PLATFORM, null, CouponStatus.ACTIVE);
  }

  async deactivatePlatform(id: string) {
    return this.setStatus(
      id,
      CouponScope.PLATFORM,
      null,
      CouponStatus.INACTIVE,
    );
  }

  async activateVendor(vendorId: string, id: string) {
    return this.setStatus(
      id,
      CouponScope.VENDOR,
      vendorId,
      CouponStatus.ACTIVE,
    );
  }

  async deactivateVendor(vendorId: string, id: string) {
    return this.setStatus(
      id,
      CouponScope.VENDOR,
      vendorId,
      CouponStatus.INACTIVE,
    );
  }

  async removePlatform(id: string) {
    const existing = await this.couponsRepository.findById(id);
    if (!existing || existing.scope !== CouponScope.PLATFORM) {
      throw new NotFoundException('Coupon not found');
    }
    await this.couponsRepository.softDelete(id);
    return { message: 'Coupon deleted successfully', data: null };
  }

  async removeVendor(vendorId: string, id: string) {
    const existing = await this.couponsRepository.findById(id);
    if (
      !existing ||
      existing.scope !== CouponScope.VENDOR ||
      existing.vendorId !== vendorId
    ) {
      throw new NotFoundException('Coupon not found');
    }
    await this.couponsRepository.softDelete(id);
    return { message: 'Coupon deleted successfully', data: null };
  }

  /**
   * Validate coupon against cart lines and return discount evaluation.
   * Throws domain errors on failure.
   */
  async evaluateCoupon(
    code: string,
    userId: string,
    lines: CartLineForCoupon[],
  ): Promise<CouponEvaluation> {
    const coupon = await this.couponsRepository.findByCode(code.trim());
    if (!coupon) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COUPON_INVALID,
        'Coupon code is invalid',
      );
    }

    if (coupon.scope === CouponScope.PLATFORM) {
      await this.assertPlatformCouponsEnabled();
    } else {
      await this.assertVendorCouponsEnabled();
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COUPON_INVALID,
        'Coupon is not active',
      );
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COUPON_NOT_APPLICABLE,
        'Coupon is not yet valid',
      );
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COUPON_EXPIRED,
        'Coupon has expired',
      );
    }

    const merchandiseTotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );

    let eligibleSubtotal = merchandiseTotal;
    if (coupon.scope === CouponScope.VENDOR) {
      if (!coupon.vendorId) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.COUPON_INVALID,
          'Coupon is misconfigured',
        );
      }
      eligibleSubtotal = lines
        .filter((line) => line.vendorId === coupon.vendorId)
        .reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
      if (eligibleSubtotal.lessThanOrEqualTo(0)) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.COUPON_NOT_APPLICABLE,
          'Coupon does not apply to items in your cart',
        );
      }
    }

    if (
      coupon.minOrderAmount &&
      eligibleSubtotal.lessThan(coupon.minOrderAmount)
    ) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.COUPON_NOT_APPLICABLE,
        `Minimum order amount is ₹${formatMoney(coupon.minOrderAmount)}`,
      );
    }

    if (coupon.usageLimit !== null && coupon.usageLimit !== undefined) {
      const used = await this.couponsRepository.countUsages(coupon.id);
      if (used >= coupon.usageLimit) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.COUPON_NOT_APPLICABLE,
          'Coupon usage limit reached',
        );
      }
    }

    if (
      coupon.usageLimitPerUser !== null &&
      coupon.usageLimitPerUser !== undefined
    ) {
      const used = await this.couponsRepository.countUsagesForUser(
        coupon.id,
        userId,
      );
      if (used >= coupon.usageLimitPerUser) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.COUPON_NOT_APPLICABLE,
          'You have already used this coupon the maximum number of times',
        );
      }
    }

    const discountAmount = this.computeDiscount(coupon, eligibleSubtotal);

    return {
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      scope: coupon.scope,
      vendorId: coupon.vendorId,
      eligibleSubtotal,
      discountAmount,
    };
  }

  allocateDiscountToLines(
    lines: Array<{
      variantId: string;
      vendorId: string;
      lineTotal: Prisma.Decimal;
    }>,
    evaluation: CouponEvaluation,
  ): Map<string, Prisma.Decimal> {
    const result = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      result.set(line.variantId, new Prisma.Decimal(0));
    }
    if (evaluation.discountAmount.lessThanOrEqualTo(0)) {
      return result;
    }

    const eligible = lines.filter((line) =>
      evaluation.vendorId ? line.vendorId === evaluation.vendorId : true,
    );
    const shares = allocateByShare(
      eligible.map((line) => line.lineTotal),
      evaluation.discountAmount,
    );
    eligible.forEach((line, index) => {
      result.set(line.variantId, shares[index] ?? new Prisma.Decimal(0));
    });
    return result;
  }

  async recordUsage(input: {
    couponId: string;
    userId: string;
    orderId: string;
    amount: Prisma.Decimal;
  }) {
    return this.couponsRepository.createUsage(input);
  }

  private computeDiscount(
    coupon: {
      discountType: CouponDiscountType;
      discountValue: Prisma.Decimal;
      maxDiscountAmount: Prisma.Decimal | null;
    },
    eligibleSubtotal: Prisma.Decimal,
  ): Prisma.Decimal {
    let discount: Prisma.Decimal;
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      discount = eligibleSubtotal
        .mul(coupon.discountValue)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (coupon.maxDiscountAmount) {
        discount = Prisma.Decimal.min(discount, coupon.maxDiscountAmount);
      }
    } else {
      discount = Prisma.Decimal.min(coupon.discountValue, eligibleSubtotal);
    }

    return discount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private async setStatus(
    id: string,
    scope: CouponScope,
    vendorId: string | null,
    status: CouponStatus,
  ) {
    const existing = await this.couponsRepository.findById(id);
    if (
      !existing ||
      existing.scope !== scope ||
      (vendorId !== null && existing.vendorId !== vendorId)
    ) {
      throw new NotFoundException('Coupon not found');
    }
    const coupon = await this.couponsRepository.update(id, { status });
    return {
      message: 'Coupon status updated successfully',
      data: this.serializeCoupon(coupon),
    };
  }

  private toUpdateData(
    dto: UpdateCouponDto,
  ): Prisma.CouponUncheckedUpdateInput {
    return {
      ...(dto.description !== undefined && {
        description: this.normalizeDescription(dto.description),
      }),
      ...(dto.discountType !== undefined && { discountType: dto.discountType }),
      ...(dto.discountValue !== undefined && {
        discountValue: new Prisma.Decimal(dto.discountValue),
      }),
      ...(dto.maxDiscountAmount !== undefined && {
        maxDiscountAmount:
          dto.maxDiscountAmount === null
            ? null
            : new Prisma.Decimal(dto.maxDiscountAmount),
      }),
      ...(dto.minOrderAmount !== undefined && {
        minOrderAmount:
          dto.minOrderAmount === null
            ? null
            : new Prisma.Decimal(dto.minOrderAmount),
      }),
      ...(dto.usageLimit !== undefined && { usageLimit: dto.usageLimit }),
      ...(dto.usageLimitPerUser !== undefined && {
        usageLimitPerUser: dto.usageLimitPerUser,
      }),
      ...(dto.startsAt !== undefined && {
        startsAt: dto.startsAt === null ? null : new Date(dto.startsAt),
      }),
      ...(dto.expiresAt !== undefined && {
        expiresAt: dto.expiresAt === null ? null : new Date(dto.expiresAt),
      }),
      ...(dto.status !== undefined && { status: dto.status }),
    };
  }

  private normalizeDescription(
    value: string | null | undefined,
  ): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private validateDiscountDto(dto: CreateCouponDto) {
    if (
      dto.discountType === CouponDiscountType.PERCENTAGE &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }
    if (
      dto.startsAt &&
      dto.expiresAt &&
      new Date(dto.expiresAt) < new Date(dto.startsAt)
    ) {
      throw new BadRequestException('expiresAt must be after startsAt');
    }
  }

  private validateUpdateDiscount(
    currentType: CouponDiscountType,
    dto: UpdateCouponDto,
  ) {
    const type = dto.discountType ?? currentType;
    if (
      type === CouponDiscountType.PERCENTAGE &&
      dto.discountValue !== undefined &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }
  }

  private async assertPlatformCouponsEnabled() {
    const enabled = await this.platformSettings.getBoolean(
      'coupons',
      'platformCouponsEnabled',
    );
    if (!enabled) {
      throw new ForbiddenException('Platform coupons are disabled');
    }
  }

  private async assertVendorCouponsEnabled() {
    const enabled = await this.platformSettings.getBoolean(
      'coupons',
      'vendorCouponsEnabled',
    );
    if (!enabled) {
      throw new ForbiddenException('Vendor coupons are disabled');
    }
  }

  private serializeCoupon(
    coupon: NonNullable<Awaited<ReturnType<CouponsRepository['findById']>>>,
  ) {
    const usedCount = coupon._count.usages;
    const expired =
      coupon.expiresAt != null && coupon.expiresAt.getTime() <= Date.now();
    return {
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      scope: coupon.scope,
      vendorId: coupon.vendorId,
      status: expired ? CouponStatus.EXPIRED : coupon.status,
      discountType: coupon.discountType,
      discountValue: formatMoney(coupon.discountValue),
      maxDiscountAmount: coupon.maxDiscountAmount
        ? formatMoney(coupon.maxDiscountAmount)
        : null,
      minOrderAmount: coupon.minOrderAmount
        ? formatMoney(coupon.minOrderAmount)
        : null,
      usageLimit: coupon.usageLimit,
      usageLimitPerUser: coupon.usageLimitPerUser,
      usedCount,
      remainingUses:
        coupon.usageLimit == null
          ? null
          : Math.max(0, coupon.usageLimit - usedCount),
      startsAt: coupon.startsAt,
      expiresAt: coupon.expiresAt,
      createdByUserId: coupon.createdByUserId,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
    };
  }
}
