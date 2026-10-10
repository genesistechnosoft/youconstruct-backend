import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
  MediaOwnerType,
  NotificationEventType,
  PlatformRole,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainConflict } from '../../common/errors/domain-exception';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { formatMoney } from '../../common/utils/money.util';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { generateSlug } from '../../common/utils/slug.util';
import { LinkMediaDto } from '../media/dto/link-media.dto';
import { ReorderMediaLinksDto } from '../media/dto/reorder-media-links.dto';
import { MediaService } from '../media/media.service';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { RbacService } from '../rbac/rbac.service';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { VendorStoreService } from '../vendor-store/vendor-store.service';
import { BrowseProductsDto } from './dto/browse-products.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { LinkThumbnailDto } from './dto/link-thumbnail.dto';
import { AdminProductFiltersDto } from './dto/admin-product-filters.dto';
import { ProductFiltersDto } from './dto/product-filters.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { SearchTagsQueryDto } from './dto/search-tags-query.dto';
import { SetAttributesDto } from './dto/set-attributes.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { planVariantReplace } from './bulk-variant.logic';
import type { BulkFieldError } from './bulk-variant.logic';
import { CheckSkusDto } from './dto/check-skus.dto';
import { ReplaceProductMediaDto } from './dto/replace-product-media.dto';
import { ReplaceVariantsDto } from './dto/replace-variants.dto';
import { normalizeProductTags } from './product-tags.util';
import { ProductsRepository } from './products.repository';
import { CategoriesService } from '../categories/categories.service';

type PendingProductContent = {
  name?: string;
  description?: string;
  shortDescription?: string;
  categoryId?: string;
  brandId?: string | null;
  tags?: string[];
  metaTitle?: string;
  metaDescription?: string;
  isReturnable?: boolean;
  returnWindowDays?: number | null;
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly mediaService: MediaService,
    private readonly vendorStoreService: VendorStoreService,
    private readonly securityAudit: SecurityAuditService,
    private readonly notifications: NotificationEmitterService,
    private readonly categoriesService: CategoriesService,
    private readonly rbacService: RbacService,
  ) {}

  async getMyProducts(userId: string, filters: ProductFiltersDto) {
    const vendorId = await this.getVendorId(userId);
    const { items, total } = await this.productsRepository.findByVendor(
      vendorId,
      filters,
    );

    return {
      message: 'Products fetched successfully',
      data: await this.withProductsMedia(items),
      meta: this.getMeta(filters.page, filters.limit, total),
    };
  }

  async getMyProduct(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    return {
      message: 'Product fetched successfully',
      data: await this.toEditorProduct(product),
    };
  }

  async searchTags(query: SearchTagsQueryDto) {
    const data = await this.productsRepository.searchActiveTags(
      query.q,
      query.limit ?? 20,
    );

    return {
      message: 'Product tags fetched successfully',
      data,
    };
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const vendorId = await this.getVendorId(userId);
    await this.vendorStoreService.assertCanCreateProduct(vendorId);
    await this.validateActiveCategory(dto.categoryId);
    await this.validateActiveBrand(dto.brandId);
    this.validateReturnInvariant(
      dto.isReturnable ?? false,
      dto.returnWindowDays,
    );

    const slug = generateSlug(dto.name);
    const existingSlug = await this.productsRepository.findBySlug(slug);
    if (existingSlug) {
      throw new ConflictException('Product slug already exists');
    }

    const created = await this.productsRepository.create({
      vendorId,
      categoryId: dto.categoryId,
      brandId: dto.brandId,
      name: dto.name,
      slug,
      description: dto.description,
      shortDescription: dto.shortDescription,
      status: ProductStatus.DRAFT,
      isReturnable: dto.isReturnable ?? false,
      returnWindowDays: dto.returnWindowDays,
      tags: normalizeProductTags(dto.tags ?? []),
      metaTitle: dto.metaTitle,
      metaDescription: dto.metaDescription,
    });

    return {
      message: 'Product created successfully',
      data: await this.toVendorProductResponse(userId, created.id),
    };
  }

  async updateProduct(
    userId: string,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const existing = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(existing.status);

    if (dto.categoryId !== undefined) {
      await this.validateActiveCategory(dto.categoryId);
    }

    if (dto.brandId !== undefined) {
      await this.validateActiveBrand(dto.brandId);
    }

    const isReturnable = dto.isReturnable ?? existing.isReturnable;
    const returnWindowDays =
      dto.isReturnable === false
        ? null
        : (dto.returnWindowDays ?? existing.returnWindowDays);
    this.validateReturnInvariant(isReturnable, returnWindowDays ?? undefined);

    if (existing.status === ProductStatus.ACTIVE) {
      const pendingContent = this.mergePendingContent(existing, dto);

      if (Object.keys(pendingContent).length === 0) {
        await this.productsRepository.update(productId, {
          pendingContent: Prisma.DbNull,
          pendingContentReview: false,
        });

        return {
          message: 'Product updated successfully',
          data: await this.toVendorProductResponse(userId, productId),
        };
      }

      await this.productsRepository.update(productId, {
        pendingContent,
        pendingContentReview: true,
      });

      return {
        message: 'Product content staged for review',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    let nextSlug: string | undefined;
    if (dto.name !== undefined && dto.name !== existing.name) {
      nextSlug = generateSlug(dto.name);
      const existingSlug = await this.productsRepository.findBySlug(
        nextSlug,
        productId,
      );
      if (existingSlug) {
        throw new ConflictException('Product slug already exists');
      }
    }

    await this.productsRepository.update(productId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(nextSlug !== undefined && { slug: nextSlug }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      ...(dto.brandId !== undefined && { brandId: dto.brandId }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.shortDescription !== undefined && {
        shortDescription: dto.shortDescription,
      }),
      ...(dto.isReturnable !== undefined && { isReturnable: dto.isReturnable }),
      ...(dto.isReturnable === false && { returnWindowDays: null }),
      ...(dto.returnWindowDays !== undefined && {
        returnWindowDays: dto.returnWindowDays,
      }),
      ...(dto.tags !== undefined && {
        tags: normalizeProductTags(dto.tags),
      }),
      ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
      ...(dto.metaDescription !== undefined && {
        metaDescription: dto.metaDescription,
      }),
    });

    return {
      message: 'Product updated successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async submitForApproval(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    if (product.status === ProductStatus.ACTIVE) {
      throw new BadRequestException(
        product.pendingContentReview
          ? 'Live product content is already awaiting admin review; do not submit again'
          : 'Live products are not submitted; catalog edits go to content review automatically',
      );
    }

    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.INACTIVE &&
      product.status !== ProductStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Only draft, inactive, or rejected products can be submitted for approval',
      );
    }

    await this.validateProductCanGoLive(productId);

    await this.productsRepository.submitForApproval(productId);
    return {
      message: 'Product submitted for approval',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async unpublishProduct(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Only active products can be unpublished');
    }

    await this.productsRepository.update(productId, {
      status: ProductStatus.INACTIVE,
    });

    return {
      message: 'Product unpublished successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteProduct(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanFullyMutateProduct(product.status);
    await this.productsRepository.softDelete(productId);
    return { message: 'Product deleted successfully', data: null };
  }

  async addVariant(userId: string, productId: string, dto: CreateVariantDto) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.validateUnits(dto.primaryUnitId, dto.baseUnitId);
    this.validatePriceInvariant(dto.price, dto.sellingPrice, dto.costPrice);
    this.validateCoverageInvariant(dto.coverageArea, dto.baseUnitId);

    const existingSku = await this.productsRepository.findVariantBySku(dto.sku);
    if (existingSku) {
      throw new ConflictException('Variant SKU already exists');
    }

    const activeVariants =
      await this.productsRepository.countActiveVariants(productId);
    const isDefault = dto.isDefault ?? activeVariants === 0;

    await this.productsRepository.createVariant({
      productId,
      sku: dto.sku,
      name: dto.name,
      price: new Prisma.Decimal(dto.price),
      sellingPrice: new Prisma.Decimal(dto.sellingPrice),
      costPrice:
        dto.costPrice !== undefined
          ? new Prisma.Decimal(dto.costPrice)
          : undefined,
      primaryUnitId: dto.primaryUnitId,
      coverageArea: dto.coverageArea,
      baseUnitId: dto.baseUnitId,
      weightKg: dto.weightKg,
      isDefault,
    });

    if (product.status === ProductStatus.ACTIVE) {
      await this.markPendingContentReview(productId);
    }

    return {
      message: 'Variant added successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async updateVariant(
    userId: string,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const variant = await this.verifyVariantOwnership(
      userId,
      productId,
      variantId,
    );
    const product = await this.productsRepository.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    this.ensureVendorCanMutateProduct(product.status);

    if (dto.sku !== undefined) {
      const existingSku = await this.productsRepository.findVariantBySku(
        dto.sku,
        variantId,
      );
      if (existingSku) {
        throw new ConflictException('Variant SKU already exists');
      }
    }

    if (dto.isDefault === false && variant.isDefault) {
      const activeDefaultVariants =
        await this.productsRepository.countActiveDefaultVariants(productId);
      if (activeDefaultVariants <= 1) {
        throw new BadRequestException(
          'Product must keep one active default variant',
        );
      }
    }

    if (dto.primaryUnitId !== undefined || dto.baseUnitId !== undefined) {
      await this.validateUnits(dto.primaryUnitId, dto.baseUnitId);
    }

    const nextPrice = dto.price ?? Number(variant.price);
    const nextSellingPrice = dto.sellingPrice ?? Number(variant.sellingPrice);
    const nextCostPrice =
      dto.costPrice !== undefined
        ? dto.costPrice
        : variant.costPrice !== null
          ? Number(variant.costPrice)
          : undefined;
    this.validatePriceInvariant(nextPrice, nextSellingPrice, nextCostPrice);

    const nextBaseUnitId =
      dto.baseUnitId !== undefined ? dto.baseUnitId : variant.baseUnitId;
    const nextCoverageArea =
      dto.coverageArea !== undefined ? dto.coverageArea : variant.coverageArea;
    this.validateCoverageInvariant(
      nextCoverageArea ?? undefined,
      nextBaseUnitId ?? undefined,
    );

    const priceOnlyUpdate =
      product.status === ProductStatus.ACTIVE &&
      this.isPriceOnlyVariantUpdate(dto);

    await this.productsRepository.updateVariant(variantId, productId, {
      ...(dto.sku !== undefined && { sku: dto.sku }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.price !== undefined && {
        price: new Prisma.Decimal(dto.price),
      }),
      ...(dto.sellingPrice !== undefined && {
        sellingPrice: new Prisma.Decimal(dto.sellingPrice),
      }),
      ...(dto.costPrice !== undefined && {
        costPrice: new Prisma.Decimal(dto.costPrice),
      }),
      ...(dto.primaryUnitId !== undefined && {
        primaryUnitId: dto.primaryUnitId,
      }),
      ...(dto.coverageArea !== undefined && {
        coverageArea: dto.coverageArea,
      }),
      ...(dto.baseUnitId !== undefined && { baseUnitId: dto.baseUnitId }),
      ...(dto.weightKg !== undefined && { weightKg: dto.weightKg }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    });

    if (product.status === ProductStatus.ACTIVE && !priceOnlyUpdate) {
      await this.markPendingContentReview(productId);
    }

    return {
      message: 'Variant updated successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteVariant(userId: string, productId: string, variantId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanFullyMutateProduct(product.status);
    const variant = await this.verifyVariantOwnership(
      userId,
      productId,
      variantId,
    );
    const activeVariants =
      await this.productsRepository.countActiveVariants(productId);
    if (activeVariants <= 1) {
      throw new BadRequestException('Product must keep at least one variant');
    }

    if (variant.isDefault) {
      throw new BadRequestException(
        'Default variant cannot be deleted. Set another default first',
      );
    }

    await this.productsRepository.softDeleteVariant(variantId);
    return {
      message: 'Variant deleted successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async updateInventory(
    userId: string,
    productId: string,
    variantId: string,
    dto: UpdateInventoryDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);

    await this.productsRepository.updateInventory(variantId, {
      quantity: dto.quantity,
      ...(dto.lowStockThreshold !== undefined && {
        lowStockThreshold: dto.lowStockThreshold,
      }),
      ...(dto.allowBackorder !== undefined && {
        allowBackorder: dto.allowBackorder,
      }),
    });

    return {
      message: 'Inventory updated successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async setVariantAttributes(
    userId: string,
    productId: string,
    variantId: string,
    dto: SetAttributesDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);
    if (dto.attributes.length > 0) {
      await this.validateAttributePayload(dto.attributes);
    }

    await this.productsRepository.setVariantAttributes(
      variantId,
      dto.attributes,
    );

    if (product.status === ProductStatus.ACTIVE) {
      await this.markPendingContentReview(productId);
    }

    return {
      message: 'Variant attributes updated successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteVariantAttribute(
    userId: string,
    productId: string,
    variantId: string,
    attributeId: string,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);
    await this.productsRepository.deleteVariantAttribute(
      variantId,
      attributeId,
    );

    if (product.status === ProductStatus.ACTIVE) {
      await this.markPendingContentReview(productId);
    }

    return {
      message: 'Variant attribute removed successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async uploadProductGalleryMedia(
    vendorProfileId: string,
    actorUserId: string,
    productId: string,
    file: Express.Multer.File | undefined,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT,
      productId,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media uploaded and linked successfully',
      data: await this.toVendorProductResponse(vendorProfileId, productId),
    };
  }

  async linkProductGalleryMedia(
    userId: string,
    productId: string,
    dto: LinkMediaDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media linked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async reorderProductGalleryMedia(
    userId: string,
    productId: string,
    dto: ReorderMediaLinksDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media links reordered successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async unlinkProductGalleryMedia(
    userId: string,
    productId: string,
    mediaId: string,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT,
      productId,
      mediaId,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media unlinked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async uploadProductThumbnail(
    vendorProfileId: string,
    actorUserId: string,
    productId: string,
    file: Express.Multer.File | undefined,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.uploadVendorMediaForEntityContext(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Product thumbnail uploaded successfully',
      data: await this.toVendorProductResponse(vendorProfileId, productId),
    };
  }

  async linkProductThumbnail(
    userId: string,
    productId: string,
    dto: LinkThumbnailDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    await this.mediaService.setEntityMediaContext(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
      dto.mediaId,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Product thumbnail linked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteProductThumbnail(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    const thumbnailCount = await this.mediaService.countContextLinks(
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
    );
    if (thumbnailCount === 0) {
      throw new NotFoundException('Product thumbnail not found');
    }

    await this.mediaService.clearEntityMediaContext(
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Product thumbnail removed successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async uploadVariantGalleryMedia(
    vendorProfileId: string,
    actorUserId: string,
    productId: string,
    variantId: string,
    file: Express.Multer.File | undefined,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(vendorProfileId, productId, variantId);

    await this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media uploaded and linked successfully',
      data: await this.toVendorProductResponse(vendorProfileId, productId),
    };
  }

  async linkVariantGalleryMedia(
    userId: string,
    productId: string,
    variantId: string,
    dto: LinkMediaDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);

    await this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media linked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async reorderVariantGalleryMedia(
    userId: string,
    productId: string,
    variantId: string,
    dto: ReorderMediaLinksDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);

    await this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media links reordered successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async unlinkVariantGalleryMedia(
    userId: string,
    productId: string,
    variantId: string,
    mediaId: string,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.verifyVariantOwnership(userId, productId, variantId);

    await this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      mediaId,
    );

    await this.recordMediaWrite(productId, product.status);

    return {
      message: 'Media unlinked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async replaceVariants(
    user: AuthenticatedUser,
    vendorProfileId: string,
    productId: string,
    dto: ReplaceVariantsDto,
    dryRun: boolean,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    this.ensureVendorCanMutateProduct(product.status);
    this.assertCurrentVersion(product.version, dto.version);

    const missingRefs = await this.missingVariantReferences(dto);
    if (missingRefs.length > 0) {
      throw new NotFoundException({
        message: 'One or more records were not found',
        error: 'NOT_FOUND',
        details: missingRefs,
      });
    }

    const existingIds = product.variants.map((variant) => variant.id);
    const [conflictingSkus, variantIdsWithOrders] = await Promise.all([
      this.productsRepository.findConflictingSkus(
        dto.variants.map((variant) => variant.sku),
        existingIds,
      ),
      this.productsRepository.findVariantIdsWithOrders(existingIds),
    ]);

    const plan = planVariantReplace({
      status: product.status,
      incoming: dto.variants,
      existing: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        price: variant.price,
        sellingPrice: variant.sellingPrice,
        costPrice: variant.costPrice,
        primaryUnitId: variant.primaryUnitId,
        coverageArea: variant.coverageArea,
        baseUnitId: variant.baseUnitId,
        weightKg: variant.weightKg,
        isDefault: variant.isDefault,
        isActive: variant.isActive,
        attributes: variant.attributes.map((attribute) => ({
          attributeId: attribute.attributeId,
          value: attribute.value,
        })),
        inventory: variant.inventory
          ? {
              quantity: variant.inventory.quantity,
              lowStockThreshold: variant.inventory.lowStockThreshold,
              allowBackorder: variant.inventory.allowBackorder,
            }
          : null,
      })),
      variantIdsWithOrders,
      conflictingSkus,
    });

    const notFound = plan.errors.filter(
      (error) => error.code === 'VARIANT_NOT_FOUND',
    );
    if (notFound.length > 0) {
      throw new NotFoundException({
        message: 'Variant not found',
        error: 'NOT_FOUND',
        details: notFound,
      });
    }
    if (plan.errors.length > 0) {
      this.throwFieldErrors(plan.errors);
    }
    if (plan.requiresInventoryPermission) {
      await this.assertInventoryPermission(user);
    }

    if (dryRun) {
      return {
        message: 'Variant save validated successfully',
        data: {
          review: plan.review,
          removed: plan.removed,
          errors: [] as BulkFieldError[],
        },
      };
    }

    const idMap = await this.productsRepository.replaceVariants({
      productId,
      expectedVersion: dto.version,
      markPendingContentReview: plan.markPendingContentReview,
      writes: plan.writes,
      removals: plan.removals,
    });

    return {
      message: 'Variants saved successfully',
      data: {
        product: await this.toVendorProductResponse(vendorProfileId, productId),
        idMap: idMap ?? {},
        removed: plan.removed,
        review: plan.review,
      },
    };
  }

  async replaceProductMedia(
    vendorProfileId: string,
    productId: string,
    dto: ReplaceProductMediaDto,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    this.ensureVendorCanMutateProduct(product.status);
    this.assertCurrentVersion(product.version, dto.version);

    const knownVariantIds = new Set(
      product.variants.map((variant) => variant.id),
    );
    const variantEntries = Object.entries(dto.variants ?? {});
    const fieldErrors: BulkFieldError[] = [];
    const notFoundErrors: BulkFieldError[] = [];

    if (new Set(dto.gallery).size !== dto.gallery.length) {
      fieldErrors.push({
        path: 'gallery',
        code: 'DUPLICATE_MEDIA',
        message: 'Duplicate media IDs are not allowed',
      });
    }

    for (const [variantId, mediaIds] of variantEntries) {
      if (!knownVariantIds.has(variantId)) {
        notFoundErrors.push({
          path: `variants.${variantId}`,
          id: variantId,
          code: 'VARIANT_NOT_FOUND',
          message: 'Variant not found',
        });
        continue;
      }
      if (
        !Array.isArray(mediaIds) ||
        mediaIds.some((mediaId) => !isUuid(mediaId))
      ) {
        fieldErrors.push({
          path: `variants.${variantId}`,
          id: variantId,
          code: 'MEDIA_INVALID',
          message: 'Gallery media ids must be UUIDs',
        });
        continue;
      }
      if (new Set(mediaIds).size !== mediaIds.length) {
        fieldErrors.push({
          path: `variants.${variantId}`,
          id: variantId,
          code: 'DUPLICATE_MEDIA',
          message: 'Duplicate media IDs are not allowed',
        });
      }
    }

    if (fieldErrors.length > 0) {
      this.throwFieldErrors(fieldErrors);
    }
    if (notFoundErrors.length > 0) {
      throw new NotFoundException({
        message: 'Variant not found',
        error: 'NOT_FOUND',
        details: notFoundErrors,
      });
    }

    const requestedMedia: { path: string; id: string }[] = [];
    if (dto.thumbnailMediaId) {
      requestedMedia.push({
        path: 'thumbnailMediaId',
        id: dto.thumbnailMediaId,
      });
    }
    dto.gallery.forEach((mediaId, index) => {
      requestedMedia.push({ path: `gallery[${index}]`, id: mediaId });
    });
    for (const [variantId, mediaIds] of variantEntries) {
      mediaIds.forEach((mediaId, index) => {
        requestedMedia.push({
          path: `variants.${variantId}[${index}]`,
          id: mediaId,
        });
      });
    }

    const ownedIds = new Set(
      await this.mediaService.findOwnedMediaIds(
        { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
        [...new Set(requestedMedia.map((item) => item.id))],
      ),
    );
    const missingMedia = requestedMedia.filter(
      (item) => !ownedIds.has(item.id),
    );
    if (missingMedia.length > 0) {
      throw new NotFoundException({
        message: 'One or more media records were not found',
        error: 'NOT_FOUND',
        details: missingMedia.map((item) => ({
          path: item.path,
          id: item.id,
          code: 'MEDIA_NOT_FOUND',
          message: 'Media record not found',
        })),
      });
    }

    const variantIds = variantEntries.map(([variantId]) => variantId);
    const [thumbnail, gallery, variantGalleries] = await Promise.all([
      this.mediaService.getEntityThumbnail(MediaEntityType.PRODUCT, productId),
      this.mediaService.getEntityGallery(MediaEntityType.PRODUCT, productId),
      this.mediaService.getOrderedGalleryMediaIds(
        MediaEntityType.PRODUCT_VARIANT,
        variantIds,
      ),
    ]);

    const pendingReview: string[] = [];
    const thumbnailChanged =
      (thumbnail?.mediaId ?? null) !== dto.thumbnailMediaId;
    if (thumbnailChanged) {
      pendingReview.push('thumbnail');
    }

    const galleryIds = gallery.map((link: { mediaId: string }) => link.mediaId);
    const galleryChanged = !sameIds(galleryIds, dto.gallery);
    if (galleryChanged) {
      pendingReview.push('gallery');
    }

    const variantGalleriesToWrite: {
      variantId: string;
      mediaIds: string[];
    }[] = [];
    for (const [variantId, mediaIds] of variantEntries) {
      const current = variantGalleries.get(variantId) ?? [];
      if (!sameIds(current, mediaIds)) {
        pendingReview.push(`variants.${variantId}.gallery`);
        variantGalleriesToWrite.push({ variantId, mediaIds });
      }
    }

    await this.productsRepository.replaceProductMedia({
      productId,
      expectedVersion: dto.version,
      markPendingContentReview:
        product.status === ProductStatus.ACTIVE && pendingReview.length > 0,
      ...(thumbnailChanged && { thumbnailMediaId: dto.thumbnailMediaId }),
      gallery: galleryChanged ? dto.gallery : null,
      variantGalleries: variantGalleriesToWrite,
    });

    return {
      message: 'Product media saved successfully',
      data: {
        product: await this.toVendorProductResponse(vendorProfileId, productId),
        review: { live: [] as string[], pendingReview },
      },
    };
  }

  async checkSkus(vendorProfileId: string, dto: CheckSkusDto) {
    if (dto.excludeProductId) {
      await this.verifyProductOwnership(vendorProfileId, dto.excludeProductId);
    }

    const taken = await this.productsRepository.findTakenSkus(
      dto.skus,
      dto.excludeProductId,
    );
    return {
      message: 'SKUs checked successfully',
      data: { taken },
    };
  }

  async browseProducts(filters: BrowseProductsDto) {
    const visibleCategoryIds =
      await this.categoriesService.getVisibleCategoryIds();
    const { items, total } = await this.productsRepository.findPublic({
      ...filters,
      visibleCategoryIds,
    });
    const cards = await this.toBrowseCards(items);

    return {
      message: 'Products fetched successfully',
      data: cards,
      meta: this.getMeta(filters.page, filters.limit, total),
    };
  }

  async browseVendorProducts(vendorId: string, page = 1, limit = 20) {
    const visibleCategoryIds =
      await this.categoriesService.getVisibleCategoryIds();
    const { items, total } = await this.productsRepository.findPublic({
      vendorId,
      page,
      limit,
      visibleCategoryIds,
    });
    const cards = await this.toBrowseCards(items);

    return {
      items: cards,
      total,
      meta: this.getMeta(page, limit, total),
    };
  }

  async getProductDetail(id: string) {
    const visibleCategoryIds =
      await this.categoriesService.getVisibleCategoryIds();
    const product = await this.productsRepository.findPublicById(
      id,
      visibleCategoryIds,
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product fetched successfully',
      data: await this.toPublicProductDetail(product),
    };
  }

  async getProductBySlug(slug: string) {
    const visibleCategoryIds =
      await this.categoriesService.getVisibleCategoryIds();
    const product = await this.productsRepository.findPublicBySlug(
      slug,
      visibleCategoryIds,
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product fetched successfully',
      data: await this.toPublicProductDetail(product),
    };
  }

  async getAllProducts(filters: AdminProductFiltersDto) {
    const { items, total } =
      await this.productsRepository.findAllAdmin(filters);

    return {
      message: 'Products fetched successfully',
      data: await this.withProductsMedia(items),
      meta: this.getMeta(filters.page, filters.limit, total),
    };
  }

  async getAdminProduct(id: string) {
    return {
      message: 'Product fetched successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  async approveProduct(id: string, actorUserId: string) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (existing.status !== ProductStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending products can be approved');
    }

    await this.validateProductCanGoLive(id);
    await this.validateActiveCategory(existing.categoryId);
    await this.validateActiveBrand(existing.brandId ?? undefined);
    await this.validateApprovedVendor(existing.vendorId);

    await this.productsRepository.update(id, {
      status: ProductStatus.ACTIVE,
      rejectionNote: null,
    });
    this.securityAudit.log({
      actorUserId,
      action: 'PRODUCT_APPROVE',
      result: 'SUCCESS',
      targetType: 'product',
      targetId: id,
    });

    const owner = await this.productsRepository.findVendorOwnerUserId(
      existing.vendorId,
    );
    if (owner) {
      this.notifications.emit({
        userId: owner.userId,
        eventType: NotificationEventType.PRODUCT_APPROVED,
        title: 'Product approved',
        body: `Your product "${existing.name}" is now live`,
        data: { productId: id },
      });
    }

    return {
      message: 'Product approved successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  async rejectProduct(id: string, actorUserId: string, dto: RejectProductDto) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (existing.status !== ProductStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending products can be rejected');
    }

    await this.productsRepository.update(id, {
      status: ProductStatus.REJECTED,
      rejectionNote: dto.rejectionNote,
    });
    this.securityAudit.log({
      actorUserId,
      action: 'PRODUCT_REJECT',
      result: 'SUCCESS',
      targetType: 'product',
      targetId: id,
      metadata: { reason: dto.rejectionNote },
    });

    const owner = await this.productsRepository.findVendorOwnerUserId(
      existing.vendorId,
    );
    if (owner) {
      this.notifications.emit({
        userId: owner.userId,
        eventType: NotificationEventType.PRODUCT_REJECTED,
        title: 'Product rejected',
        body: dto.rejectionNote,
        data: { productId: id },
      });
    }

    return {
      message: 'Product rejected successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  async approveContentReview(id: string, actorUserId: string) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (existing.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active products can have content approved',
      );
    }

    if (!existing.pendingContentReview) {
      throw new BadRequestException('Product has no pending content review');
    }

    const pending = (existing.pendingContent ?? {}) as PendingProductContent;

    if (pending.categoryId !== undefined) {
      await this.validateActiveCategory(pending.categoryId);
    }
    if (pending.brandId !== undefined && pending.brandId !== null) {
      await this.validateActiveBrand(pending.brandId);
    }

    const nextIsReturnable = pending.isReturnable ?? existing.isReturnable;
    const nextReturnWindowDays =
      pending.isReturnable === false
        ? null
        : (pending.returnWindowDays ?? existing.returnWindowDays);
    this.validateReturnInvariant(
      nextIsReturnable,
      nextReturnWindowDays ?? undefined,
    );

    const updateData: Prisma.ProductUncheckedUpdateInput = {
      pendingContent: Prisma.DbNull,
      pendingContentReview: false,
      rejectionNote: null,
    };

    if (pending.name !== undefined) updateData.name = pending.name;
    if (pending.description !== undefined) {
      updateData.description = pending.description;
    }
    if (pending.shortDescription !== undefined) {
      updateData.shortDescription = pending.shortDescription;
    }
    if (pending.categoryId !== undefined) {
      updateData.categoryId = pending.categoryId;
    }
    if (pending.brandId !== undefined) updateData.brandId = pending.brandId;
    if (pending.tags !== undefined) updateData.tags = pending.tags;
    if (pending.metaTitle !== undefined)
      updateData.metaTitle = pending.metaTitle;
    if (pending.metaDescription !== undefined) {
      updateData.metaDescription = pending.metaDescription;
    }
    if (pending.isReturnable !== undefined) {
      updateData.isReturnable = pending.isReturnable;
    }
    if (pending.isReturnable === false) {
      updateData.returnWindowDays = null;
    } else if (pending.returnWindowDays !== undefined) {
      updateData.returnWindowDays = pending.returnWindowDays;
    }

    await this.productsRepository.update(id, updateData);

    this.securityAudit.log({
      actorUserId,
      action: 'PRODUCT_CONTENT_APPROVE',
      result: 'SUCCESS',
      targetType: 'product',
      targetId: id,
    });

    return {
      message: 'Product content approved successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  async rejectContentReview(
    id: string,
    actorUserId: string,
    dto: RejectProductDto,
  ) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (existing.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active products can have content rejected',
      );
    }

    if (!existing.pendingContentReview) {
      throw new BadRequestException('Product has no pending content review');
    }

    await this.productsRepository.update(id, {
      pendingContent: Prisma.DbNull,
      pendingContentReview: false,
      rejectionNote: dto.rejectionNote,
    });

    this.securityAudit.log({
      actorUserId,
      action: 'PRODUCT_CONTENT_REJECT',
      result: 'SUCCESS',
      targetType: 'product',
      targetId: id,
      metadata: { reason: dto.rejectionNote },
    });

    return {
      message: 'Product content rejected successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  private async getVendorId(vendorProfileId: string) {
    const vendor =
      await this.productsRepository.findApprovedVendorById(vendorProfileId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile required');
    }

    return vendor.id;
  }

  private async verifyProductOwnership(
    vendorProfileId: string,
    productId: string,
  ) {
    const vendorId = await this.getVendorId(vendorProfileId);
    const product = await this.productsRepository.findByVendorAndId(
      vendorId,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async verifyVariantOwnership(
    vendorProfileId: string,
    productId: string,
    variantId: string,
  ) {
    await this.verifyProductOwnership(vendorProfileId, productId);
    const variant = await this.productsRepository.findVariant(
      variantId,
      productId,
    );

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    return variant;
  }

  private async validateActiveCategory(categoryId: string) {
    const category = await this.productsRepository.findCategoryById(categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private async validateActiveBrand(brandId?: string) {
    if (!brandId) {
      return;
    }

    const brand = await this.productsRepository.findBrandById(brandId);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
  }

  private async validateApprovedVendor(vendorId: string) {
    const vendor =
      await this.productsRepository.findApprovedVendorById(vendorId);
    if (!vendor) {
      throw new BadRequestException('Product vendor is not approved');
    }
  }

  private async validateProductCanGoLive(productId: string) {
    const [activeVariants, defaultVariants, thumbnailCount] = await Promise.all(
      [
        this.productsRepository.countActiveVariants(productId),
        this.productsRepository.countActiveDefaultVariants(productId),
        this.mediaService.countContextLinks(
          MediaEntityType.PRODUCT,
          productId,
          MediaContext.THUMBNAIL,
        ),
      ],
    );

    if (activeVariants === 0) {
      throw new BadRequestException(
        'Product must have at least one active variant',
      );
    }

    if (defaultVariants !== 1) {
      throw new BadRequestException(
        'Product must have exactly one active default variant',
      );
    }

    if (thumbnailCount === 0) {
      throw new BadRequestException('Product must have a thumbnail image');
    }
  }

  private ensureVendorCanMutateProduct(status: ProductStatus) {
    if (status === ProductStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Pending products cannot be changed until reviewed',
      );
    }
  }

  private ensureVendorCanFullyMutateProduct(status: ProductStatus) {
    this.ensureVendorCanMutateProduct(status);

    if (status === ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'Active products cannot be deleted; unpublish first',
      );
    }
  }

  private assertCurrentVersion(current: number, expected: number) {
    if (current !== expected) {
      throw domainConflict(
        DOMAIN_ERROR_CODES.STALE_VERSION,
        'Product was updated. Reload and try again.',
      );
    }
  }

  private throwFieldErrors(details: BulkFieldError[]): never {
    throw new BadRequestException({
      message: 'Validation failed',
      error: 'VALIDATION_ERROR',
      details,
    });
  }

  private async missingVariantReferences(dto: ReplaceVariantsDto) {
    const details: BulkFieldError[] = [];
    const unitIds = [
      ...new Set(
        dto.variants.flatMap((variant) =>
          [variant.primaryUnitId, variant.baseUnitId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ];
    const attributeIds = [
      ...new Set(
        dto.variants.flatMap((variant) =>
          variant.attributes.map((attribute) => attribute.attributeId),
        ),
      ),
    ];
    const units = await this.productsRepository.findUnitsByIds(unitIds);
    const attributeRows =
      attributeIds.length === 0
        ? []
        : await this.productsRepository.findAttributeDefinitionsByIds(
            attributeIds,
          );
    const unitSet = new Set(units.map((unit) => unit.id));
    const attributeSet = new Set(
      attributeRows.map((attribute) => attribute.id),
    );

    dto.variants.forEach((variant, index) => {
      const identity = {
        ...(variant.id ? { id: variant.id } : {}),
        ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
      };
      if (!unitSet.has(variant.primaryUnitId)) {
        details.push({
          path: `variants[${index}].primaryUnitId`,
          ...identity,
          code: 'UNIT_NOT_FOUND',
          message: 'Primary unit not found',
        });
      }
      if (variant.baseUnitId && !unitSet.has(variant.baseUnitId)) {
        details.push({
          path: `variants[${index}].baseUnitId`,
          ...identity,
          code: 'UNIT_NOT_FOUND',
          message: 'Base unit not found',
        });
      }
      variant.attributes.forEach((attribute, attributeIndex) => {
        if (!attributeSet.has(attribute.attributeId)) {
          details.push({
            path: `variants[${index}].attributes[${attributeIndex}].attributeId`,
            ...identity,
            code: 'ATTRIBUTE_NOT_FOUND',
            message: 'Attribute not found',
          });
        }
      });
    });

    return details;
  }

  private async assertInventoryPermission(user: AuthenticatedUser) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return;
    }

    const required = [PERMISSIONS.VENDOR.INVENTORY_MANAGE];
    if (user.activeContext?.isOwner) {
      const inScope = await this.rbacService.scopeDefinesAllPermissions(
        user.activeContext.type,
        required,
      );
      if (!inScope) {
        throw new ForbiddenException(
          'You do not have permission to access this resource',
        );
      }
      return;
    }

    if (!user.activeContext?.customRoleId) {
      throw new ForbiddenException('Active context required');
    }

    const allowed = await this.rbacService.hasPermissions(
      user.activeContext.customRoleId,
      required,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }
  }

  private async markPendingContentReview(productId: string) {
    await this.productsRepository.setPendingContentReview(productId);
  }

  private async recordMediaWrite(productId: string, status: ProductStatus) {
    await this.productsRepository.incrementVersion(productId);
    if (status === ProductStatus.ACTIVE) {
      await this.markPendingContentReview(productId);
    }
  }

  private mergePendingContent(
    existing: {
      name: string;
      description: string;
      shortDescription: string;
      categoryId: string;
      brandId: string | null;
      tags: string[];
      metaTitle: string;
      metaDescription: string;
      isReturnable: boolean;
      returnWindowDays: number | null;
      pendingContent: unknown;
    },
    dto: UpdateProductDto,
  ): PendingProductContent {
    const pending: PendingProductContent = {
      ...((existing.pendingContent as PendingProductContent | null) ?? {}),
    };

    const setOrClear = <K extends keyof PendingProductContent>(
      key: K,
      next: PendingProductContent[K],
      live: PendingProductContent[K],
    ) => {
      if (this.pendingValuesEqual(next, live)) {
        delete pending[key];
      } else {
        pending[key] = next;
      }
    };

    if (dto.name !== undefined) {
      setOrClear('name', dto.name, existing.name);
    }
    if (dto.description !== undefined) {
      setOrClear('description', dto.description, existing.description);
    }
    if (dto.shortDescription !== undefined) {
      setOrClear(
        'shortDescription',
        dto.shortDescription,
        existing.shortDescription,
      );
    }
    if (dto.categoryId !== undefined) {
      setOrClear('categoryId', dto.categoryId, existing.categoryId);
    }
    if (dto.brandId !== undefined) {
      setOrClear('brandId', dto.brandId, existing.brandId);
    }
    if (dto.tags !== undefined) {
      setOrClear('tags', normalizeProductTags(dto.tags), existing.tags);
    }
    if (dto.metaTitle !== undefined) {
      setOrClear('metaTitle', dto.metaTitle, existing.metaTitle);
    }
    if (dto.metaDescription !== undefined) {
      setOrClear(
        'metaDescription',
        dto.metaDescription,
        existing.metaDescription,
      );
    }
    if (dto.isReturnable !== undefined) {
      setOrClear('isReturnable', dto.isReturnable, existing.isReturnable);
    }
    if (dto.isReturnable === false) {
      setOrClear('returnWindowDays', null, existing.returnWindowDays);
    } else if (dto.returnWindowDays !== undefined) {
      setOrClear(
        'returnWindowDays',
        dto.returnWindowDays,
        existing.returnWindowDays,
      );
    }

    return pending;
  }

  private pendingValuesEqual(
    left: PendingProductContent[keyof PendingProductContent],
    right: PendingProductContent[keyof PendingProductContent],
  ) {
    if (Array.isArray(left) || Array.isArray(right)) {
      const leftTags = Array.isArray(left) ? [...left].sort() : [];
      const rightTags = Array.isArray(right) ? [...right].sort() : [];
      return (
        leftTags.length === rightTags.length &&
        leftTags.every((value, index) => value === rightTags[index])
      );
    }

    return left === right;
  }

  private isPriceOnlyVariantUpdate(dto: UpdateVariantDto) {
    const keys = Object.keys(dto) as (keyof UpdateVariantDto)[];
    if (keys.length === 0) {
      return true;
    }

    const priceKeys = new Set<keyof UpdateVariantDto>([
      'price',
      'sellingPrice',
      'costPrice',
    ]);

    return keys.every((key) => priceKeys.has(key));
  }

  private async validateUnits(primaryUnitId?: string, baseUnitId?: string) {
    if (primaryUnitId) {
      const primaryUnit =
        await this.productsRepository.findUnitById(primaryUnitId);
      if (!primaryUnit) {
        throw new NotFoundException('Primary unit not found');
      }
    }

    if (baseUnitId) {
      const baseUnit = await this.productsRepository.findUnitById(baseUnitId);
      if (!baseUnit) {
        throw new NotFoundException('Base unit not found');
      }
    }
  }

  private validatePriceInvariant(
    price: number,
    sellingPrice: number,
    costPrice?: number,
  ) {
    if (sellingPrice > price) {
      throw new BadRequestException('Selling price cannot exceed price');
    }

    if (costPrice !== undefined && costPrice > price) {
      throw new BadRequestException('Cost price cannot exceed price');
    }
  }

  private validateReturnInvariant(
    isReturnable: boolean,
    returnWindowDays?: number,
  ) {
    if (!isReturnable && returnWindowDays !== undefined) {
      throw new BadRequestException(
        'Return window days can only be set for returnable products',
      );
    }

    if (
      isReturnable &&
      (returnWindowDays === undefined || returnWindowDays <= 0)
    ) {
      throw new BadRequestException(
        'Returnable products must have a positive return window',
      );
    }
  }

  private validateCoverageInvariant(
    coverageArea?: number,
    baseUnitId?: string,
  ) {
    if (coverageArea === undefined) {
      return;
    }

    if (coverageArea <= 0) {
      throw new BadRequestException('Coverage area must be greater than 0');
    }

    if (!baseUnitId) {
      throw new BadRequestException('Base unit is required with coverage area');
    }
  }

  private async validateAttributePayload(
    attributes: { attributeId: string; value: string }[],
  ) {
    const attributeIds = attributes.map((attribute) => attribute.attributeId);
    const uniqueAttributeIds = new Set(attributeIds);

    if (uniqueAttributeIds.size !== attributeIds.length) {
      throw new BadRequestException('Duplicate attribute IDs are not allowed');
    }

    const definitions =
      await this.productsRepository.findAttributeDefinitionsByIds(attributeIds);

    if (definitions.length !== uniqueAttributeIds.size) {
      throw new NotFoundException('One or more attributes were not found');
    }
  }

  private getMeta(page: number, limit: number, total: number) {
    const { take } = paginate(page, limit);
    return paginationMeta(page, take, total);
  }

  private async toBrowseCards(
    products: Awaited<ReturnType<ProductsRepository['findPublic']>>['items'],
  ) {
    const productIds = products.map((product) => product.id);
    const primaryImages = await this.mediaService.getPrimaryImagesForEntities(
      MediaEntityType.PRODUCT,
      productIds,
    );

    return products.map((product) => {
      const variant = product.variants[0];
      const quantity = variant?.inventory?.quantity ?? 0;
      const allowBackorder = variant?.inventory?.allowBackorder ?? false;
      const stockQuantity = quantity <= 0 && !allowBackorder ? 0 : quantity;

      return {
        id: product.id,
        categoryId: product.categoryId,
        brandId: product.brandId,
        name: product.name,
        slug: product.slug,
        shortDescription: product.shortDescription,
        status: product.status,
        tags: product.tags,
        category: product.category,
        brand: product.brand,
        vendor: product.vendor,
        variantCount: product._count.variants,
        displayPrice: variant ? formatMoney(variant.sellingPrice) : null,
        unit: variant?.primaryUnit
          ? {
              id: variant.primaryUnit.id,
              name: variant.primaryUnit.name,
              symbol: variant.primaryUnit.symbol,
            }
          : null,
        stockQuantity,
        primaryImage: primaryImages.get(product.id) ?? null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      };
    });
  }

  private async toVendorProductResponse(
    vendorProfileId: string,
    productId: string,
  ) {
    const product = await this.verifyProductOwnership(
      vendorProfileId,
      productId,
    );
    return this.toEditorProduct(product);
  }

  private async toEditorProduct<
    T extends {
      id: string;
      variants?: { id: string; isActive: boolean; isDefault: boolean }[];
    },
  >(product: T) {
    const withMedia = await this.withProductMedia(product);
    return {
      ...withMedia,
      submitBlockers: this.buildSubmitBlockers({
        thumbnail: withMedia.thumbnail,
        variants: product.variants,
      }),
    };
  }

  private buildSubmitBlockers(product: {
    thumbnail: unknown;
    variants?: { isActive: boolean; isDefault: boolean }[];
  }) {
    const blockers: string[] = [];
    if (!product.thumbnail) {
      blockers.push('NO_THUMBNAIL');
    }

    const active = (product.variants ?? []).filter(
      (variant) => variant.isActive,
    );
    if (active.length === 0) {
      blockers.push('NO_ACTIVE_VARIANT');
    }
    if (active.filter((variant) => variant.isDefault).length !== 1) {
      blockers.push('NO_DEFAULT_VARIANT');
    }

    return blockers;
  }

  private async toAdminProductResponse(productId: string) {
    const product = await this.productsRepository.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.withProductMedia(product);
  }

  private async withProductsMedia<T extends { id: string }>(products: T[]) {
    if (products.length === 0) {
      return products.map((product) => ({
        ...product,
        media: [],
        thumbnail: null,
      }));
    }

    const productIds = products.map((product) => product.id);
    const [galleries, thumbnails] = await Promise.all([
      this.mediaService.getGalleriesForEntities(
        MediaEntityType.PRODUCT,
        productIds,
      ),
      this.mediaService.getThumbnailsForEntities(productIds),
    ]);

    return products.map((product) => ({
      ...product,
      media: galleries.get(product.id) ?? [],
      thumbnail: thumbnails.get(product.id) ?? null,
    }));
  }

  private async toSellerCard(vendor: {
    id: string;
    businessName: string;
    slug: string | null;
    bio: string | null;
    about: string | null;
    businessAddress: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    storeSettings: {
      supportPhone: string | null;
      supportEmail: string | null;
    } | null;
  }) {
    const logos = await this.mediaService.getContextFilesForEntities(
      MediaEntityType.VENDOR_PROFILE,
      [vendor.id],
      MediaContext.LOGO,
    );

    return {
      id: vendor.id,
      slug: vendor.slug,
      businessName: vendor.businessName,
      bio: vendor.bio,
      about: vendor.about,
      address: {
        line1: vendor.businessAddress,
        city: vendor.city,
        state: vendor.state,
        pincode: vendor.pincode,
      },
      phone: vendor.storeSettings?.supportPhone ?? null,
      email: vendor.storeSettings?.supportEmail ?? null,
      memberSince: vendor.approvedAt ?? vendor.createdAt,
      logo: logos.get(vendor.id) ?? null,
    };
  }

  private async toPublicProductDetail<
    T extends {
      id: string;
      variants: Array<{
        id: string;
        inventory: { quantity: number; allowBackorder: boolean } | null;
      }>;
    },
  >(product: T) {
    const withMedia = await this.withProductMedia(product);
    const seller =
      'vendor' in withMedia &&
      withMedia.vendor !== null &&
      typeof withMedia.vendor === 'object'
        ? await this.toSellerCard(
            withMedia.vendor as Parameters<ProductsService['toSellerCard']>[0],
          )
        : undefined;
    return {
      ...withMedia,
      ...(seller !== undefined ? { vendor: seller } : {}),
      variants: withMedia.variants.map(({ inventory, ...rest }) => {
        const quantity = inventory?.quantity ?? 0;
        const allowBackorder = inventory?.allowBackorder ?? false;
        return {
          ...rest,
          allowBackorder,
          stockQuantity: quantity <= 0 && !allowBackorder ? 0 : quantity,
        };
      }),
    };
  }

  private async withProductMedia<
    T extends { id: string; variants?: { id: string }[] },
  >(product: T) {
    const [media, thumbnail] = await Promise.all([
      this.mediaService.getEntityGallery(MediaEntityType.PRODUCT, product.id),
      this.mediaService.getEntityThumbnail(MediaEntityType.PRODUCT, product.id),
    ]);

    if (!product.variants) {
      return { ...product, media, thumbnail };
    }

    const variantGalleries = await this.mediaService.getGalleriesForEntities(
      MediaEntityType.PRODUCT_VARIANT,
      product.variants.map((variant) => variant.id),
    );

    const variants = product.variants.map((variant) => ({
      ...variant,
      media: variantGalleries.get(variant.id) ?? [],
    }));

    return { ...product, media, thumbnail, variants };
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}
