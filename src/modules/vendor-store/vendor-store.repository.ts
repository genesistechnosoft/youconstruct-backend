import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PreferredPaymentMethod,
  Prisma,
  ProductStatus,
  ShippingMethodType,
  ShippingUnitType,
  VendorPlan,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const STORE_SETTINGS_SELECT = {
  id: true,
  vendorId: true,
  shippingPolicy: true,
  refundPolicy: true,
  cancellationPolicy: true,
  preferredPaymentMethod: true,
  supportPhone: true,
  supportEmail: true,
  supportAddressLine1: true,
  supportAddressLine2: true,
  supportCity: true,
  supportState: true,
  supportPincode: true,
  seoTitle: true,
  seoDescription: true,
  seoKeywords: true,
  ogTitle: true,
  ogDescription: true,
  twitterTitle: true,
  twitterDescription: true,
  socialInstagram: true,
  socialFacebook: true,
  socialTwitter: true,
  socialYoutube: true,
  socialLinkedin: true,
  socialPinterest: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const MEMBERSHIP_SELECT = {
  id: true,
  vendorId: true,
  plan: true,
  startedAt: true,
  expiresAt: true,
  isActive: true,
  storageLimitMb: true,
  storageUsedMb: true,
  productLimit: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const SHIPPING_TIER_SELECT = {
  id: true,
  shippingMethodId: true,
  minOrderValue: true,
  maxOrderValue: true,
  shippingCharge: true,
  createdAt: true,
} as const;

export const SHIPPING_METHOD_SELECT = {
  id: true,
  vendorId: true,
  methodType: true,
  flatCharge: true,
  isFree: true,
  freeAboveOrderValue: true,
  freeWithinKm: true,
  chargeBeyondKm: true,
  unitCharge: true,
  unitType: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  orderValueTiers: {
    orderBy: { minOrderValue: 'asc' as const },
    select: SHIPPING_TIER_SELECT,
  },
} as const;

export const PRODUCT_SHIPPING_SELECT = {
  id: true,
  productId: true,
  methodType: true,
  flatCharge: true,
  isFree: true,
  freeAboveOrderValue: true,
  freeWithinKm: true,
  chargeBeyondKm: true,
  unitCharge: true,
  unitType: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ShippingMethodChargeData = {
  methodType: ShippingMethodType;
  flatCharge?: Prisma.Decimal | null;
  isFree?: boolean;
  freeAboveOrderValue?: Prisma.Decimal | null;
  freeWithinKm?: number | null;
  chargeBeyondKm?: Prisma.Decimal | null;
  unitCharge?: Prisma.Decimal | null;
  unitType?: ShippingUnitType | null;
  isActive?: boolean;
};

@Injectable()
export class VendorStoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  findApprovedVendorById(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, isApproved: true, deletedAt: null },
      select: { id: true },
    });
  }

  findVendorById(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, deletedAt: null },
      select: { id: true },
    });
  }

  findVendorAbout(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, deletedAt: null },
      select: { about: true },
    });
  }

  updateVendorAbout(vendorId: string, about: string | null) {
    return this.prisma.vendorProfile.update({
      where: { id: vendorId },
      data: { about },
      select: { about: true },
    });
  }

  findStoreSettings(vendorId: string) {
    return this.prisma.vendorStoreSettings.findUnique({
      where: { vendorId },
      select: STORE_SETTINGS_SELECT,
    });
  }

  async ensureStoreSettings(vendorId: string) {
    try {
      return await this.prisma.vendorStoreSettings.upsert({
        where: { vendorId },
        update: {},
        create: { vendorId },
        select: STORE_SETTINGS_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateStoreSettings(
    vendorId: string,
    data: {
      shippingPolicy?: string | null;
      refundPolicy?: string | null;
      cancellationPolicy?: string | null;
      preferredPaymentMethod?: PreferredPaymentMethod | null;
      supportPhone?: string | null;
      supportEmail?: string | null;
      supportAddressLine1?: string | null;
      supportAddressLine2?: string | null;
      supportCity?: string | null;
      supportState?: string | null;
      supportPincode?: string | null;
      seoTitle?: string | null;
      seoDescription?: string | null;
      seoKeywords?: string | null;
      ogTitle?: string | null;
      ogDescription?: string | null;
      twitterTitle?: string | null;
      twitterDescription?: string | null;
      socialInstagram?: string | null;
      socialFacebook?: string | null;
      socialTwitter?: string | null;
      socialYoutube?: string | null;
      socialLinkedin?: string | null;
      socialPinterest?: string | null;
    },
  ) {
    try {
      await this.ensureStoreSettings(vendorId);
      return await this.prisma.vendorStoreSettings.update({
        where: { vendorId },
        data,
        select: STORE_SETTINGS_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findMembership(vendorId: string) {
    return this.prisma.vendorMembership.findUnique({
      where: { vendorId },
      select: MEMBERSHIP_SELECT,
    });
  }

  async ensureMembership(vendorId: string) {
    try {
      return await this.prisma.vendorMembership.upsert({
        where: { vendorId },
        update: {},
        create: { vendorId },
        select: MEMBERSHIP_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countVendorProducts(vendorId: string) {
    return this.prisma.product.count({
      where: {
        vendorId,
        deletedAt: null,
        status: {
          in: [ProductStatus.ACTIVE, ProductStatus.PENDING_APPROVAL],
        },
      },
    });
  }

  async updateMembership(
    vendorId: string,
    data: {
      plan?: VendorPlan;
      storageLimitMb?: number;
      productLimit?: number | null;
      expiresAt?: Date | null;
      isActive?: boolean;
      startedAt?: Date;
    },
  ) {
    try {
      await this.ensureMembership(vendorId);
      return await this.prisma.vendorMembership.update({
        where: { vendorId },
        data,
        select: MEMBERSHIP_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findApprovedVendorGeo(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, isApproved: true, deletedAt: null },
      select: { id: true, latitude: true, longitude: true },
    });
  }

  findShippingMethod(vendorId: string) {
    return this.prisma.vendorShippingMethod.findUnique({
      where: { vendorId },
      select: SHIPPING_METHOD_SELECT,
    });
  }

  async upsertShippingMethod(vendorId: string, data: ShippingMethodChargeData) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const method = await tx.vendorShippingMethod.upsert({
          where: { vendorId },
          create: {
            vendorId,
            methodType: data.methodType,
            flatCharge: data.flatCharge ?? null,
            isFree: data.isFree ?? false,
            freeAboveOrderValue: data.freeAboveOrderValue ?? null,
            freeWithinKm: data.freeWithinKm ?? null,
            chargeBeyondKm: data.chargeBeyondKm ?? null,
            unitCharge: data.unitCharge ?? null,
            unitType: data.unitType ?? null,
            isActive: data.isActive ?? true,
          },
          update: {
            methodType: data.methodType,
            flatCharge: data.flatCharge ?? null,
            isFree: data.isFree ?? false,
            freeAboveOrderValue: data.freeAboveOrderValue ?? null,
            freeWithinKm: data.freeWithinKm ?? null,
            chargeBeyondKm: data.chargeBeyondKm ?? null,
            unitCharge: data.unitCharge ?? null,
            unitType: data.unitType ?? null,
            isActive: data.isActive ?? true,
          },
          select: { id: true, methodType: true },
        });

        if (data.methodType !== ShippingMethodType.ORDER_VALUE_BASED) {
          await tx.vendorShippingOrderValueTier.deleteMany({
            where: { shippingMethodId: method.id },
          });
        }

        return tx.vendorShippingMethod.findUniqueOrThrow({
          where: { id: method.id },
          select: SHIPPING_METHOD_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  listTiers(shippingMethodId: string) {
    return this.prisma.vendorShippingOrderValueTier.findMany({
      where: { shippingMethodId },
      orderBy: { minOrderValue: 'asc' },
      select: SHIPPING_TIER_SELECT,
    });
  }

  async createTier(
    shippingMethodId: string,
    data: {
      minOrderValue: Prisma.Decimal;
      maxOrderValue: Prisma.Decimal | null;
      shippingCharge: Prisma.Decimal;
    },
  ) {
    try {
      return await this.prisma.vendorShippingOrderValueTier.create({
        data: {
          shippingMethodId,
          minOrderValue: data.minOrderValue,
          maxOrderValue: data.maxOrderValue,
          shippingCharge: data.shippingCharge,
        },
        select: SHIPPING_TIER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findTierForVendor(tierId: string, vendorId: string) {
    return this.prisma.vendorShippingOrderValueTier.findFirst({
      where: {
        id: tierId,
        shippingMethod: { vendorId },
      },
      select: SHIPPING_TIER_SELECT,
    });
  }

  async deleteTier(tierId: string) {
    try {
      await this.prisma.vendorShippingOrderValueTier.delete({
        where: { id: tierId },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findProductByVendorAndId(vendorId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId, vendorId, deletedAt: null },
      select: { id: true },
    });
  }

  findProductShippingOverride(productId: string) {
    return this.prisma.productShippingOverride.findUnique({
      where: { productId },
      select: PRODUCT_SHIPPING_SELECT,
    });
  }

  async upsertProductShippingOverride(
    productId: string,
    data: Omit<ShippingMethodChargeData, 'isActive'>,
  ) {
    try {
      return await this.prisma.productShippingOverride.upsert({
        where: { productId },
        create: {
          productId,
          methodType: data.methodType,
          flatCharge: data.flatCharge ?? null,
          isFree: data.isFree ?? false,
          freeAboveOrderValue: data.freeAboveOrderValue ?? null,
          freeWithinKm: data.freeWithinKm ?? null,
          chargeBeyondKm: data.chargeBeyondKm ?? null,
          unitCharge: data.unitCharge ?? null,
          unitType: data.unitType ?? null,
        },
        update: {
          methodType: data.methodType,
          flatCharge: data.flatCharge ?? null,
          isFree: data.isFree ?? false,
          freeAboveOrderValue: data.freeAboveOrderValue ?? null,
          freeWithinKm: data.freeWithinKm ?? null,
          chargeBeyondKm: data.chargeBeyondKm ?? null,
          unitCharge: data.unitCharge ?? null,
          unitType: data.unitType ?? null,
        },
        select: PRODUCT_SHIPPING_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deleteProductShippingOverride(productId: string) {
    try {
      await this.prisma.productShippingOverride.delete({
        where: { productId },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Vendor store resource already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Vendor store resource not found');
    }

    throw error;
  }
}
