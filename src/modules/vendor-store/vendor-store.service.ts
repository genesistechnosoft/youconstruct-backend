import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
  MediaOwnerType,
  Prisma,
  ShippingMethodType,
  ShippingUnitType,
} from '../../../generated/prisma/client.js';
import { MediaService } from '../media/media.service';
import { CreateShippingTierDto } from './dto/create-shipping-tier.dto';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { UpdateVendorMembershipDto } from './dto/update-vendor-membership.dto';
import { UpsertProductShippingDto } from './dto/upsert-product-shipping.dto';
import { UpsertShippingMethodDto } from './dto/upsert-shipping-method.dto';
import {
  type ShippingMethodChargeData,
  VendorStoreRepository,
} from './vendor-store.repository';

type ShippingChargeInput = {
  methodType: ShippingMethodType;
  flatCharge?: number | null;
  isFree?: boolean;
  freeAboveOrderValue?: number | null;
  freeWithinKm?: number | null;
  chargeBeyondKm?: number | null;
  unitCharge?: number | null;
  unitType?: ShippingUnitType | null;
  isActive?: boolean;
};

@Injectable()
export class VendorStoreService {
  constructor(
    private readonly vendorStoreRepository: VendorStoreRepository,
    @Inject(forwardRef(() => MediaService))
    private readonly mediaService: MediaService,
  ) {}

  async getStoreSettings(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const settings =
      await this.vendorStoreRepository.ensureStoreSettings(vendorProfileId);

    return {
      message: 'Store settings fetched successfully',
      data: await this.withAbout(
        vendorProfileId,
        await this.withStoreBrandMedia(vendorProfileId, settings),
      ),
    };
  }

  async uploadStoreBrandMedia(
    vendorProfileId: string,
    actorUserId: string,
    context: MediaContext,
    file: Express.Multer.File | undefined,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    return this.mediaService.uploadVendorMediaForEntityContext(
      actorUserId,
      vendorProfileId,
      file,
      MediaEntityType.VENDOR_PROFILE,
      vendorProfileId,
      context,
    );
  }

  async linkStoreBrandMedia(
    vendorProfileId: string,
    context: MediaContext,
    mediaId: string,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    return this.mediaService.setEntityMediaContext(
      { ownerType: MediaOwnerType.VENDOR, ownerId: vendorProfileId },
      MediaEntityType.VENDOR_PROFILE,
      vendorProfileId,
      context,
      mediaId,
    );
  }

  async clearStoreBrandMedia(vendorProfileId: string, context: MediaContext) {
    await this.requireApprovedVendor(vendorProfileId);
    return this.mediaService.clearEntityMediaContext(
      MediaEntityType.VENDOR_PROFILE,
      vendorProfileId,
      context,
    );
  }

  async getStoreBrandMedia(vendorProfileId: string) {
    const [logo, banner] = await Promise.all([
      this.mediaService.getEntityMediaByContext(
        MediaEntityType.VENDOR_PROFILE,
        vendorProfileId,
        MediaContext.LOGO,
      ),
      this.mediaService.getEntityMediaByContext(
        MediaEntityType.VENDOR_PROFILE,
        vendorProfileId,
        MediaContext.BANNER,
      ),
    ]);

    return { logo, banner };
  }

  async updateStoreSettings(
    vendorProfileId: string,
    dto: UpdateStoreSettingsDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    const { about, ...settingsDto } = dto;
    const settings = await this.vendorStoreRepository.updateStoreSettings(
      vendorProfileId,
      settingsDto,
    );
    if (about !== undefined) {
      await this.vendorStoreRepository.updateVendorAbout(
        vendorProfileId,
        this.normalizeAbout(about),
      );
    }

    return {
      message: 'Store settings updated successfully',
      data: await this.withAbout(
        vendorProfileId,
        await this.withStoreBrandMedia(vendorProfileId, settings),
      ),
    };
  }

  async getMembership(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const membership =
      await this.vendorStoreRepository.ensureMembership(vendorProfileId);
    const productCount =
      await this.vendorStoreRepository.countVendorProducts(vendorProfileId);

    return {
      message: 'Membership fetched successfully',
      data: {
        ...membership,
        productCount,
      },
    };
  }

  async updateMembership(vendorId: string, dto: UpdateVendorMembershipDto) {
    const vendor = await this.vendorStoreRepository.findVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const existing =
      await this.vendorStoreRepository.ensureMembership(vendorId);

    const data: {
      plan?: UpdateVendorMembershipDto['plan'];
      storageLimitMb?: number;
      productLimit?: number | null;
      expiresAt?: Date | null;
      isActive?: boolean;
      startedAt?: Date;
    } = {};

    if (dto.plan !== undefined) {
      data.plan = dto.plan;
      if (dto.plan !== existing.plan) {
        data.startedAt = new Date();
      }
    }
    if (dto.storageLimitMb !== undefined) {
      data.storageLimitMb = dto.storageLimitMb;
    }
    if (dto.productLimit !== undefined) {
      data.productLimit = dto.productLimit;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const membership = await this.vendorStoreRepository.updateMembership(
      vendorId,
      data,
    );
    const productCount =
      await this.vendorStoreRepository.countVendorProducts(vendorId);

    return {
      message: 'Vendor membership updated successfully',
      data: {
        ...membership,
        productCount,
      },
    };
  }

  /**
   * Used by products/media to enforce plan limits without querying Prisma there.
   */
  async getMembershipLimits(vendorId: string) {
    const membership =
      await this.vendorStoreRepository.ensureMembership(vendorId);
    const productCount =
      await this.vendorStoreRepository.countVendorProducts(vendorId);

    return {
      storageLimitMb: membership.storageLimitMb,
      storageUsedMb: membership.storageUsedMb,
      productLimit: membership.productLimit,
      productCount,
      isActive: membership.isActive,
    };
  }

  async assertCanCreateProduct(vendorId: string) {
    const limits = await this.getMembershipLimits(vendorId);
    if (!limits.isActive) {
      throw new ForbiddenException('Vendor membership is inactive');
    }
    if (
      limits.productLimit !== null &&
      limits.productCount >= limits.productLimit
    ) {
      throw new ForbiddenException(
        `Product limit reached (${limits.productLimit}). Upgrade your plan to add more products.`,
      );
    }
  }

  async assertCanUploadMedia(vendorId: string, sizeBytes: number) {
    const limits = await this.getMembershipLimits(vendorId);
    if (!limits.isActive) {
      throw new ForbiddenException('Vendor membership is inactive');
    }
    if (limits.storageLimitMb === 0) {
      return;
    }

    const incomingMb = sizeBytes / (1024 * 1024);
    if (limits.storageUsedMb + incomingMb > limits.storageLimitMb) {
      throw new ForbiddenException(
        `Storage limit reached (${limits.storageLimitMb} MB). Upgrade your plan or free up space.`,
      );
    }
  }

  async getStoreShipping(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const method =
      await this.vendorStoreRepository.findShippingMethod(vendorProfileId);

    return {
      message: 'Store shipping fetched successfully',
      data: method,
    };
  }

  async upsertStoreShipping(
    vendorProfileId: string,
    dto: UpsertShippingMethodDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    await this.validateShippingChargeInput(dto, {
      requireGeo: true,
      vendorId: vendorProfileId,
      allowOrderValueBased: true,
    });

    const method = await this.vendorStoreRepository.upsertShippingMethod(
      vendorProfileId,
      this.toChargeData(dto),
    );

    return {
      message: 'Store shipping updated successfully',
      data: method,
    };
  }

  async addShippingTier(vendorProfileId: string, dto: CreateShippingTierDto) {
    await this.requireApprovedVendor(vendorProfileId);
    const method =
      await this.vendorStoreRepository.findShippingMethod(vendorProfileId);
    if (!method) {
      throw new BadRequestException(
        'Set an ORDER_VALUE_BASED shipping method before adding tiers',
      );
    }
    if (method.methodType !== ShippingMethodType.ORDER_VALUE_BASED) {
      throw new BadRequestException(
        'Tiers are only allowed for ORDER_VALUE_BASED shipping',
      );
    }

    if (
      dto.maxOrderValue !== undefined &&
      dto.maxOrderValue !== null &&
      dto.maxOrderValue <= dto.minOrderValue
    ) {
      throw new BadRequestException(
        'maxOrderValue must be greater than minOrderValue',
      );
    }

    this.assertNoTierOverlap(method.orderValueTiers, dto);

    const tier = await this.vendorStoreRepository.createTier(method.id, {
      minOrderValue: new Prisma.Decimal(dto.minOrderValue),
      maxOrderValue:
        dto.maxOrderValue === undefined || dto.maxOrderValue === null
          ? null
          : new Prisma.Decimal(dto.maxOrderValue),
      shippingCharge: new Prisma.Decimal(dto.shippingCharge),
    });

    return {
      message: 'Shipping tier added successfully',
      data: tier,
    };
  }

  async deleteShippingTier(vendorProfileId: string, tierId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const tier = await this.vendorStoreRepository.findTierForVendor(
      tierId,
      vendorProfileId,
    );
    if (!tier) {
      throw new NotFoundException('Shipping tier not found');
    }

    await this.vendorStoreRepository.deleteTier(tierId);

    return {
      message: 'Shipping tier deleted successfully',
      data: null,
    };
  }

  async getProductShipping(vendorProfileId: string, productId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    await this.requireOwnedProduct(vendorProfileId, productId);
    const override =
      await this.vendorStoreRepository.findProductShippingOverride(productId);

    return {
      message: 'Product shipping override fetched successfully',
      data: override,
    };
  }

  async upsertProductShipping(
    vendorProfileId: string,
    productId: string,
    dto: UpsertProductShippingDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    await this.requireOwnedProduct(vendorProfileId, productId);

    if (dto.methodType === ShippingMethodType.ORDER_VALUE_BASED) {
      throw new BadRequestException(
        'ORDER_VALUE_BASED is not allowed on product overrides; use store shipping tiers',
      );
    }

    await this.validateShippingChargeInput(dto, {
      requireGeo: true,
      vendorId: vendorProfileId,
      allowOrderValueBased: false,
    });

    const override =
      await this.vendorStoreRepository.upsertProductShippingOverride(
        productId,
        this.toChargeData(dto),
      );

    return {
      message: 'Product shipping override updated successfully',
      data: override,
    };
  }

  async deleteProductShipping(vendorProfileId: string, productId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    await this.requireOwnedProduct(vendorProfileId, productId);
    const existing =
      await this.vendorStoreRepository.findProductShippingOverride(productId);
    if (!existing) {
      throw new NotFoundException('Product shipping override not found');
    }

    await this.vendorStoreRepository.deleteProductShippingOverride(productId);

    return {
      message: 'Product shipping override removed successfully',
      data: null,
    };
  }

  private async requireOwnedProduct(vendorId: string, productId: string) {
    const product = await this.vendorStoreRepository.findProductByVendorAndId(
      vendorId,
      productId,
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product.id;
  }

  private toChargeData(input: ShippingChargeInput): ShippingMethodChargeData {
    return {
      methodType: input.methodType,
      flatCharge:
        input.flatCharge === undefined || input.flatCharge === null
          ? null
          : new Prisma.Decimal(input.flatCharge),
      isFree: input.isFree ?? false,
      freeAboveOrderValue:
        input.freeAboveOrderValue === undefined ||
        input.freeAboveOrderValue === null
          ? null
          : new Prisma.Decimal(input.freeAboveOrderValue),
      freeWithinKm: input.freeWithinKm ?? null,
      chargeBeyondKm:
        input.chargeBeyondKm === undefined || input.chargeBeyondKm === null
          ? null
          : new Prisma.Decimal(input.chargeBeyondKm),
      unitCharge:
        input.unitCharge === undefined || input.unitCharge === null
          ? null
          : new Prisma.Decimal(input.unitCharge),
      unitType: input.unitType ?? null,
      isActive: input.isActive ?? true,
    };
  }

  private async validateShippingChargeInput(
    input: ShippingChargeInput,
    options: {
      requireGeo: boolean;
      vendorId: string;
      allowOrderValueBased: boolean;
    },
  ) {
    if (
      !options.allowOrderValueBased &&
      input.methodType === ShippingMethodType.ORDER_VALUE_BASED
    ) {
      throw new BadRequestException(
        'ORDER_VALUE_BASED is not allowed for this resource',
      );
    }

    switch (input.methodType) {
      case ShippingMethodType.FLAT:
        if (input.flatCharge === undefined || input.flatCharge === null) {
          throw new BadRequestException('flatCharge is required for FLAT');
        }
        break;
      case ShippingMethodType.FREE: {
        if (input.isFree !== true) {
          throw new BadRequestException('isFree must be true for FREE');
        }
        if (
          input.freeAboveOrderValue !== undefined &&
          input.freeAboveOrderValue !== null &&
          (input.flatCharge === undefined || input.flatCharge === null)
        ) {
          throw new BadRequestException(
            'flatCharge is required when freeAboveOrderValue is set (fallback below threshold)',
          );
        }
        break;
      }
      case ShippingMethodType.DISTANCE_BASED: {
        if (input.freeWithinKm === undefined || input.freeWithinKm === null) {
          throw new BadRequestException(
            'freeWithinKm is required for DISTANCE_BASED',
          );
        }
        if (
          input.chargeBeyondKm === undefined ||
          input.chargeBeyondKm === null
        ) {
          throw new BadRequestException(
            'chargeBeyondKm is required for DISTANCE_BASED',
          );
        }
        if (options.requireGeo) {
          const vendor = await this.vendorStoreRepository.findApprovedVendorGeo(
            options.vendorId,
          );
          if (
            !vendor ||
            vendor.latitude === null ||
            vendor.longitude === null
          ) {
            throw new BadRequestException(
              'Vendor latitude and longitude are required for DISTANCE_BASED shipping',
            );
          }
        }
        break;
      }
      case ShippingMethodType.UNIT_BASED:
        if (input.unitCharge === undefined || input.unitCharge === null) {
          throw new BadRequestException(
            'unitCharge is required for UNIT_BASED',
          );
        }
        if (input.unitType === undefined || input.unitType === null) {
          throw new BadRequestException('unitType is required for UNIT_BASED');
        }
        break;
      case ShippingMethodType.ORDER_VALUE_BASED:
        break;
      default:
        throw new BadRequestException('Unsupported shipping method type');
    }
  }

  private assertNoTierOverlap(
    existing: Array<{
      minOrderValue: Prisma.Decimal;
      maxOrderValue: Prisma.Decimal | null;
    }>,
    incoming: CreateShippingTierDto,
  ) {
    const newMin = incoming.minOrderValue;
    const newMax =
      incoming.maxOrderValue === undefined ? null : incoming.maxOrderValue;

    for (const tier of existing) {
      const existingMin = Number(tier.minOrderValue);
      const existingMax =
        tier.maxOrderValue === null ? null : Number(tier.maxOrderValue);

      if (this.rangesOverlap(newMin, newMax, existingMin, existingMax)) {
        throw new BadRequestException(
          'Shipping tier overlaps an existing order-value range',
        );
      }
    }
  }

  private rangesOverlap(
    aMin: number,
    aMax: number | null,
    bMin: number,
    bMax: number | null,
  ): boolean {
    const aEnd = aMax ?? Number.POSITIVE_INFINITY;
    const bEnd = bMax ?? Number.POSITIVE_INFINITY;
    return aMin < bEnd && bMin < aEnd;
  }

  private normalizeAbout(value: string | null): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async withAbout<T extends object>(
    vendorProfileId: string,
    data: T,
  ) {
    const vendor =
      await this.vendorStoreRepository.findVendorAbout(vendorProfileId);
    return { ...data, about: vendor?.about ?? null };
  }

  private async withStoreBrandMedia<T extends object>(
    vendorProfileId: string,
    settings: T,
  ) {
    const { logo, banner } = await this.getStoreBrandMedia(vendorProfileId);

    return {
      ...settings,
      logo: logo?.url ? { url: logo.url, mediaId: logo.mediaId } : null,
      banner: banner?.url
        ? { url: banner.url, mediaId: banner.mediaId }
        : null,
    };
  }

  private async requireApprovedVendor(vendorProfileId: string) {
    const vendor =
      await this.vendorStoreRepository.findApprovedVendorById(vendorProfileId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile required');
    }
    return vendor.id;
  }
}
