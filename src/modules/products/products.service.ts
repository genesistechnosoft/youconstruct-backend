import { randomUUID } from 'node:crypto';
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
import type { BulkFieldError, PlannedVariantWrite } from './bulk-variant.logic';
import {
  catalogMatchesPublished,
  draftSkuConflicts,
  moneyToDraft,
  parseCatalogDraft,
  seedCatalogDraft,
  skusToReserve,
  type CatalogDraft,
  type CatalogDraftVariant,
} from './catalog-draft';
import { CheckSkusDto } from './dto/check-skus.dto';
import { ReplaceProductMediaDto } from './dto/replace-product-media.dto';
import { ReplaceVariantsDto } from './dto/replace-variants.dto';
import { normalizeProductTags } from './product-tags.util';
import { ProductsRepository } from './products.repository';
import type { LivePriceWrite, ProductFactWrite } from './products.repository';
import { CategoriesService } from '../categories/categories.service';

type OwnedProduct = NonNullable<
  Awaited<ReturnType<ProductsRepository['findByVendorAndId']>>
>;

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
      data: this.withDraftFlag(await this.withProductsMedia(items)),
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
    await this.assertSlugAvailable(slug);

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
      const staged = await this.stageCatalog(existing, (draft) =>
        this.applyScalarPatch(draft, dto),
      );
      return {
        message:
          staged === 'staged'
            ? 'Product content staged for review'
            : 'Product updated successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    const slugFollowsName =
      existing.status === ProductStatus.DRAFT ||
      existing.status === ProductStatus.PENDING_APPROVAL ||
      existing.status === ProductStatus.REJECTED;
    let nextSlug: string | undefined;
    if (
      slugFollowsName &&
      dto.name !== undefined &&
      dto.name !== existing.name
    ) {
      nextSlug = generateSlug(dto.name);
      await this.assertSlugAvailable(nextSlug, productId);
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
        product.catalogDraft
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

    if (product.catalogDraft) {
      throw new BadRequestException(
        'Discard the catalog draft before unpublishing',
      );
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

  async discardCatalogDraft(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    if (!product.catalogDraft) {
      throw new BadRequestException('Product has no catalog draft');
    }

    await this.productsRepository.clearCatalogDraft(productId);
    return {
      message: 'Catalog draft discarded',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async addVariant(userId: string, productId: string, dto: CreateVariantDto) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
    await this.validateUnits(dto.primaryUnitId, dto.baseUnitId);
    this.validatePriceInvariant(dto.price, dto.sellingPrice, dto.costPrice);
    this.validateCoverageInvariant(dto.coverageArea, dto.baseUnitId);

    if (product.status === ProductStatus.ACTIVE) {
      const taken = await this.productsRepository.findTakenSkus(
        [dto.sku],
        product.id,
      );
      if (
        taken.length > 0 ||
        product.variants.some((variant) => variant.sku === dto.sku)
      ) {
        throw new ConflictException('Variant SKU already exists');
      }

      await this.stageCatalog(product, (draft) => {
        if (draft.variants.some((variant) => variant.sku === dto.sku)) {
          throw new ConflictException('Variant SKU already exists');
        }

        const isDefault =
          dto.isDefault ?? !draft.variants.some((variant) => variant.isActive);
        const variants = isDefault
          ? draft.variants.map((variant) => ({ ...variant, isDefault: false }))
          : draft.variants;
        return {
          ...draft,
          variants: [...variants, this.draftVariantFromCreate(dto, isDefault)],
        };
      });

      return {
        message: 'Variant added successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

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
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    if (product.status === ProductStatus.ACTIVE) {
      await this.updateActiveVariant(product, variantId, dto);
      return {
        message: 'Variant updated successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    const variant = await this.verifyVariantOwnership(
      userId,
      productId,
      variantId,
    );

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

    return {
      message: 'Variant updated successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteVariant(userId: string, productId: string, variantId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      await this.stageCatalog(product, (draft) => {
        const target = draft.variants.find(
          (variant) => variant.id === variantId,
        );
        if (!target) {
          throw new NotFoundException('Variant not found');
        }
        if (target.isDefault) {
          throw new BadRequestException(
            'Default variant cannot be deleted. Set another default first',
          );
        }

        const variants = draft.variants.filter(
          (variant) => variant.id !== variantId,
        );
        if (!variants.some((variant) => variant.isActive)) {
          throw new BadRequestException(
            'Product must keep at least one variant',
          );
        }

        return { ...draft, variants };
      });

      return {
        message: 'Variant deleted successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

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
    const live = product.variants.find((variant) => variant.id === variantId);

    if (live) {
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

    if (product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Variant not found');
    }

    this.assertKnownVariant(product, variantId);
    await this.stageCatalog(product, (draft) => ({
      ...draft,
      variants: draft.variants.map((variant) => {
        if (variant.id !== variantId) {
          return variant;
        }

        const inventory = variant.inventory ?? {
          quantity: 0,
          lowStockThreshold: 5,
          allowBackorder: false,
        };
        return {
          ...variant,
          inventory: {
            quantity: dto.quantity,
            lowStockThreshold:
              dto.lowStockThreshold ?? inventory.lowStockThreshold,
            allowBackorder: dto.allowBackorder ?? inventory.allowBackorder,
          },
        };
      }),
    }));

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
    const attributes = this.canonicalOptionAttributes(product, dto.attributes);
    if (product.status === ProductStatus.ACTIVE) {
      if (attributes.length > 0) {
        await this.validateAttributePayload(attributes);
      }
      this.assertKnownVariant(product, variantId);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => ({
          ...variant,
          attributes,
        })),
      }));

      return {
        message: 'Variant attributes updated successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.verifyVariantOwnership(userId, productId, variantId);
    if (attributes.length > 0) {
      await this.validateAttributePayload(attributes);
    }

    await this.productsRepository.setVariantAttributes(variantId, attributes);

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
    this.assertOptionAttributes(product, [{ attributeId }]);
    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => {
          if (
            !variant.attributes.some(
              (attribute) => attribute.attributeId === attributeId,
            )
          ) {
            throw new NotFoundException('Variant attribute not found');
          }

          return {
            ...variant,
            attributes: variant.attributes.filter(
              (attribute) => attribute.attributeId !== attributeId,
            ),
          };
        }),
      }));

      return {
        message: 'Variant attribute removed successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.verifyVariantOwnership(userId, productId, variantId);
    await this.productsRepository.deleteVariantAttribute(
      variantId,
      attributeId,
    );

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

    if (product.status === ProductStatus.ACTIVE) {
      const media = await this.mediaService.uploadUnlinkedVendorMedia(
        actorUserId,
        product.vendorId,
        file,
        false,
      );
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        galleryMediaIds: [...draft.galleryMediaIds, media.id],
      }));

      return {
        message: 'Media uploaded and linked successfully',
        data: await this.toVendorProductResponse(vendorProfileId, productId),
      };
    }

    await this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT,
      productId,
    );

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      await this.assertOwnedMedia(product.vendorId, dto.mediaIds);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        galleryMediaIds: this.appendMediaIds(draft.galleryMediaIds, dto.mediaIds),
      }));

      return {
        message: 'Media linked successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      await this.stageCatalog(product, (draft) => {
        this.assertGalleryReorder(draft.galleryMediaIds, dto.mediaIds);
        return { ...draft, galleryMediaIds: dto.mediaIds };
      });

      return {
        message: 'Media links reordered successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      await this.stageCatalog(product, (draft) => {
        if (!draft.galleryMediaIds.includes(mediaId)) {
          throw new NotFoundException('Media link not found');
        }

        return {
          ...draft,
          galleryMediaIds: draft.galleryMediaIds.filter((id) => id !== mediaId),
        };
      });

      return {
        message: 'Media unlinked successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT,
      productId,
      mediaId,
    );

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      const media = await this.mediaService.uploadUnlinkedVendorMedia(
        actorUserId,
        product.vendorId,
        file,
        true,
      );
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        thumbnailMediaId: media.id,
      }));

      return {
        message: 'Product thumbnail uploaded successfully',
        data: await this.toVendorProductResponse(vendorProfileId, productId),
      };
    }

    await this.mediaService.uploadVendorMediaForEntityContext(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
    );

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      await this.assertOwnedMedia(product.vendorId, [dto.mediaId]);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        thumbnailMediaId: dto.mediaId,
      }));

      return {
        message: 'Product thumbnail linked successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.mediaService.setEntityMediaContext(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT,
      productId,
      MediaContext.THUMBNAIL,
      dto.mediaId,
    );

    await this.productsRepository.incrementVersion(productId);

    return {
      message: 'Product thumbnail linked successfully',
      data: await this.toVendorProductResponse(userId, productId),
    };
  }

  async deleteProductThumbnail(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    if (product.status === ProductStatus.ACTIVE) {
      await this.stageCatalog(product, (draft) => {
        if (!draft.thumbnailMediaId) {
          throw new NotFoundException('Product thumbnail not found');
        }

        return { ...draft, thumbnailMediaId: null };
      });

      return {
        message: 'Product thumbnail removed successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

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

    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      const media = await this.mediaService.uploadUnlinkedVendorMedia(
        actorUserId,
        product.vendorId,
        file,
        false,
      );
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => ({
          ...variant,
          galleryMediaIds: [...variant.galleryMediaIds, media.id],
        })),
      }));

      return {
        message: 'Media uploaded and linked successfully',
        data: await this.toVendorProductResponse(vendorProfileId, productId),
      };
    }

    await this.verifyVariantOwnership(vendorProfileId, productId, variantId);
    await this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
    );
    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      await this.assertOwnedMedia(product.vendorId, dto.mediaIds);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => ({
          ...variant,
          galleryMediaIds: this.appendMediaIds(
            variant.galleryMediaIds,
            dto.mediaIds,
          ),
        })),
      }));

      return {
        message: 'Media linked successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.verifyVariantOwnership(userId, productId, variantId);
    await this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );
    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => {
          this.assertGalleryReorder(variant.galleryMediaIds, dto.mediaIds);
          return { ...variant, galleryMediaIds: dto.mediaIds };
        }),
      }));

      return {
        message: 'Media links reordered successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.verifyVariantOwnership(userId, productId, variantId);
    await this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );
    await this.productsRepository.incrementVersion(productId);

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

    if (product.status === ProductStatus.ACTIVE) {
      this.assertKnownVariant(product, variantId);
      await this.stageCatalog(product, (draft) => ({
        ...draft,
        variants: this.requireVariant(draft, variantId, (variant) => {
          if (!variant.galleryMediaIds.includes(mediaId)) {
            throw new NotFoundException('Media link not found');
          }

          return {
            ...variant,
            galleryMediaIds: variant.galleryMediaIds.filter(
              (id) => id !== mediaId,
            ),
          };
        }),
      }));

      return {
        message: 'Media unlinked successfully',
        data: await this.toVendorProductResponse(userId, productId),
      };
    }

    await this.verifyVariantOwnership(userId, productId, variantId);
    await this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      mediaId,
    );
    await this.productsRepository.incrementVersion(productId);

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

    const facts = this.normalizeProductFacts(dto);
    const variants = this.normalizeVariantOptions(dto.variants, facts);
    const missingRefs = await this.missingVariantReferences({
      ...dto,
      variants,
      specs: facts.specs,
      options: facts.options,
    });
    if (missingRefs.length > 0) {
      throw new NotFoundException({
        message: 'One or more records were not found',
        error: 'NOT_FOUND',
        details: missingRefs,
      });
    }

    const existing = this.plannerExisting(product);
    const liveIds = product.variants.map((variant) => variant.id);
    const [conflictingSkus, variantIdsWithOrders] = await Promise.all([
      this.productsRepository.findConflictingSkus(
        variants.map((variant) => variant.sku),
        existing.map((variant) => variant.id),
        product.id,
      ),
      this.productsRepository.findVariantIdsWithOrders(liveIds),
    ]);

    const plan = planVariantReplace({
      status: product.status,
      incoming: variants,
      existing,
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

    if (product.status === ProductStatus.ACTIVE) {
      const idMap: Record<string, string> = {};
      const livePrices = this.livePricesFromWrites(product.variants, plan.writes);
      if (plan.review.pendingReview.length > 0 || this.factsDiffer(product, facts)) {
        await this.stageCatalog(
          product,
          (draft) => ({
            ...this.applyVariantWrites(draft, plan.writes, idMap),
            specs: facts.specs,
            options: facts.options,
          }),
          { expectedVersion: dto.version, livePrices },
        );
      } else if (livePrices.length > 0) {
        await this.productsRepository.applyLivePrices({
          productId,
          expectedVersion: dto.version,
          livePrices,
        });
      }

      return {
        message: 'Variants saved successfully',
        data: {
          product: await this.toVendorProductResponse(
            vendorProfileId,
            productId,
          ),
          idMap,
          removed: plan.removed,
          review: plan.review,
        },
      };
    }

    const idMap = await this.productsRepository.replaceVariants({
      productId,
      expectedVersion: dto.version,
      writes: plan.writes,
      removals: plan.removals,
      facts,
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
      product.status === ProductStatus.ACTIVE && product.catalogDraft
        ? this.readDraft(product.catalogDraft).variants.map(
            (variant) => variant.id,
          )
        : product.variants.map((variant) => variant.id),
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

    if (product.status === ProductStatus.ACTIVE) {
      const baseline = product.catalogDraft
        ? this.readDraft(product.catalogDraft)
        : await this.publishedDraft(product);
      const pendingReview: string[] = [];
      if (baseline.thumbnailMediaId !== dto.thumbnailMediaId) {
        pendingReview.push('thumbnail');
      }
      if (!sameIds(baseline.galleryMediaIds, dto.gallery)) {
        pendingReview.push('gallery');
      }
      for (const [variantId, mediaIds] of variantEntries) {
        const current =
          baseline.variants.find((variant) => variant.id === variantId)
            ?.galleryMediaIds ?? [];
        if (!sameIds(current, mediaIds)) {
          pendingReview.push(`variants.${variantId}.gallery`);
        }
      }

      if (pendingReview.length > 0) {
        await this.stageCatalog(
          product,
          (draft) => ({
            ...draft,
            thumbnailMediaId: dto.thumbnailMediaId,
            galleryMediaIds: dto.gallery,
            variants: draft.variants.map((variant) => {
              const next = dto.variants?.[variant.id];
              return next
                ? { ...variant, galleryMediaIds: next }
                : variant;
            }),
          }),
          { expectedVersion: dto.version },
        );
      }

      return {
        message: 'Product media saved successfully',
        data: {
          product: await this.toVendorProductResponse(
            vendorProfileId,
            productId,
          ),
          review: { live: [] as string[], pendingReview },
        },
      };
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
    const direct = await this.productsRepository.findPublicBySlug(
      slug,
      visibleCategoryIds,
    );
    const product =
      direct ??
      (await this.publicProductFromRedirect(slug, visibleCategoryIds));
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product fetched successfully',
      data: await this.toPublicProductDetail(product),
    };
  }

  private async publicProductFromRedirect(
    slug: string,
    visibleCategoryIds: string[],
  ) {
    const redirect = await this.productsRepository.findSlugRedirect(slug);
    if (!redirect) {
      return null;
    }

    return this.productsRepository.findPublicById(
      redirect.productId,
      visibleCategoryIds,
    );
  }

  async getAllProducts(filters: AdminProductFiltersDto) {
    const { items, total } =
      await this.productsRepository.findAllAdmin(filters);

    return {
      message: 'Products fetched successfully',
      data: this.withDraftFlag(await this.withProductsMedia(items)),
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

    if (!existing.catalogDraft) {
      throw new BadRequestException('Product has no catalog draft');
    }

    const draft = this.readDraft(existing.catalogDraft);
    await this.validateActiveCategory(draft.categoryId);
    await this.validateActiveBrand(draft.brandId ?? undefined);
    this.validateReturnInvariant(
      draft.isReturnable,
      draft.returnWindowDays ?? undefined,
    );

    const active = draft.variants.filter((variant) => variant.isActive);
    if (active.length === 0) {
      throw new BadRequestException(
        'Product must have at least one active variant',
      );
    }
    if (active.filter((variant) => variant.isDefault).length !== 1) {
      throw new BadRequestException(
        'Product must have exactly one active default variant',
      );
    }
    if (!draft.thumbnailMediaId) {
      throw new BadRequestException('Product must have a thumbnail image');
    }

    await this.productsRepository.applyCatalogDraft({
      productId: id,
      slug: existing.slug,
      draft,
      liveVariantIds: existing.variants.map((variant) => variant.id),
      deactivate: existing.variants
        .filter(
          (variant) =>
            !draft.variants.some((next) => next.id === variant.id),
        )
        .map((variant) => ({ id: variant.id, sku: variant.sku })),
    });

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

    if (!existing.catalogDraft) {
      throw new BadRequestException('Product has no catalog draft');
    }

    await this.productsRepository.rejectCatalogDraft(id, dto.rejectionNote);

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

  async changeProductSlug(id: string, rawSlug: string) {
    const slug = generateSlug(rawSlug);
    if (!slug) {
      throw new BadRequestException('Product slug is empty');
    }

    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (slug !== existing.slug) {
      await this.productsRepository.changeSlug(id, existing.slug, slug);
    }

    return {
      message: 'Product slug updated successfully',
      data: await this.toAdminProductResponse(id),
    };
  }

  private async assertSlugAvailable(slug: string, excludeProductId?: string) {
    const taken = await this.productsRepository.findBySlug(
      slug,
      excludeProductId,
    );
    if (taken) {
      throw new ConflictException('Product slug already exists');
    }

    const redirect = await this.productsRepository.findSlugRedirect(slug);
    if (redirect && redirect.productId !== excludeProductId) {
      throw new ConflictException('Product slug already exists');
    }
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
      ...new Set([
        ...dto.specs.map((spec) => spec.attributeId),
        ...dto.options.map((option) => option.attributeId),
        ...dto.variants.flatMap((variant) =>
          variant.attributes.map((attribute) => attribute.attributeId),
        ),
      ]),
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

    dto.specs.forEach((spec, index) => {
      if (!attributeSet.has(spec.attributeId)) {
        details.push({
          path: `specs[${index}].attributeId`,
          code: 'ATTRIBUTE_NOT_FOUND',
          message: 'Attribute not found',
        });
      }
    });
    dto.options.forEach((option, index) => {
      if (!attributeSet.has(option.attributeId)) {
        details.push({
          path: `options[${index}].attributeId`,
          code: 'ATTRIBUTE_NOT_FOUND',
          message: 'Attribute not found',
        });
      }
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

  private readDraft(value: unknown) {
    try {
      return parseCatalogDraft(value);
    } catch {
      throw new BadRequestException('Catalog draft is invalid');
    }
  }

  private async publishedDraft(product: OwnedProduct) {
    const variantIds = product.variants.map((variant) => variant.id);
    const [thumbnail, gallery, variantGalleries] = await Promise.all([
      this.mediaService.getEntityThumbnail(MediaEntityType.PRODUCT, product.id),
      this.mediaService.getEntityGallery(MediaEntityType.PRODUCT, product.id),
      this.mediaService.getOrderedGalleryMediaIds(
        MediaEntityType.PRODUCT_VARIANT,
        variantIds,
      ),
    ]);

    return seedCatalogDraft({
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      categoryId: product.categoryId,
      brandId: product.brandId,
      tags: product.tags,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      isReturnable: product.isReturnable,
      returnWindowDays: product.returnWindowDays,
      thumbnailMediaId: thumbnail?.mediaId ?? null,
      galleryMediaIds: gallery.map((link) => link.mediaId),
      specs: product.specs.map((spec) => ({
        attributeId: spec.attributeId,
        value: spec.value,
        position: spec.position,
      })),
      options: product.options.map((option) => ({
        attributeId: option.attributeId,
        position: option.position,
        values: option.values.map((value) => value.value),
      })),
      variants: product.variants.map((variant) => ({
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
        galleryMediaIds: variantGalleries.get(variant.id) ?? [],
        inventory: variant.inventory
          ? {
              quantity: variant.inventory.quantity,
              lowStockThreshold: variant.inventory.lowStockThreshold,
              allowBackorder: variant.inventory.allowBackorder,
            }
          : null,
      })),
    });
  }

  private async stageCatalog(
    product: OwnedProduct,
    mutate: (draft: CatalogDraft) => CatalogDraft,
    options?: { expectedVersion?: number; livePrices?: LivePriceWrite[] },
  ) {
    const published = await this.publishedDraft(product);
    const current = product.catalogDraft
      ? this.readDraft(product.catalogDraft)
      : published;
    const next = mutate(structuredClone(current));
    const conflicts = draftSkuConflicts(
      next,
      product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
      })),
      new Set(
        await this.productsRepository.findTakenSkus(
          [...new Set(next.variants.map((variant) => variant.sku))],
          product.id,
        ),
      ),
    );
    if (conflicts.length > 0) {
      throw new ConflictException('Variant SKU already exists');
    }

    const clear = catalogMatchesPublished(next, published);
    await this.productsRepository.saveCatalogDraft({
      productId: product.id,
      expectedVersion: options?.expectedVersion ?? product.version,
      draft: clear ? null : next,
      reservedSkus: clear
        ? []
        : skusToReserve(
            next,
            product.variants.map((variant) => variant.sku),
          ),
      livePrices: options?.livePrices ?? [],
    });

    return clear ? ('cleared' as const) : ('staged' as const);
  }

  private applyScalarPatch(draft: CatalogDraft, dto: UpdateProductDto) {
    const isReturnable = dto.isReturnable ?? draft.isReturnable;
    const returnWindowDays =
      dto.isReturnable === false
        ? null
        : (dto.returnWindowDays ?? draft.returnWindowDays);

    return {
      ...draft,
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.shortDescription !== undefined && {
        shortDescription: dto.shortDescription,
      }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      ...(dto.brandId !== undefined && { brandId: dto.brandId }),
      ...(dto.tags !== undefined && { tags: normalizeProductTags(dto.tags) }),
      ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
      ...(dto.metaDescription !== undefined && {
        metaDescription: dto.metaDescription,
      }),
      isReturnable,
      returnWindowDays,
    };
  }

  private draftVariantFromCreate(
    dto: CreateVariantDto,
    isDefault: boolean,
  ): CatalogDraftVariant {
    return {
      id: randomUUID(),
      sku: dto.sku,
      name: dto.name ?? null,
      price: moneyToDraft(dto.price),
      sellingPrice: moneyToDraft(dto.sellingPrice),
      costPrice:
        dto.costPrice === undefined ? null : moneyToDraft(dto.costPrice),
      primaryUnitId: dto.primaryUnitId,
      coverageArea: dto.coverageArea ?? null,
      baseUnitId: dto.baseUnitId ?? null,
      weightKg: dto.weightKg ?? null,
      isDefault,
      isActive: true,
      attributes: [],
      galleryMediaIds: [],
      inventory: {
        quantity: 0,
        lowStockThreshold: 5,
        allowBackorder: false,
      },
    };
  }

  private assertKnownVariant(product: OwnedProduct, variantId: string) {
    const inLive = product.variants.some((variant) => variant.id === variantId);
    const inDraft = product.catalogDraft
      ? this.readDraft(product.catalogDraft).variants.some(
          (variant) => variant.id === variantId,
        )
      : false;
    if (!inLive && !inDraft) {
      throw new NotFoundException('Variant not found');
    }
  }

  private requireVariant(
    draft: CatalogDraft,
    variantId: string,
    update: (variant: CatalogDraftVariant) => CatalogDraftVariant,
  ) {
    let found = false;
    const variants = draft.variants.map((variant) => {
      if (variant.id !== variantId) {
        return variant;
      }

      found = true;
      return update(variant);
    });
    if (!found) {
      throw new NotFoundException('Variant not found');
    }

    return variants;
  }

  private async updateActiveVariant(
    product: OwnedProduct,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    this.assertKnownVariant(product, variantId);
    const live = product.variants.find((variant) => variant.id === variantId);
    const priceOnly = Boolean(live) && this.isPriceOnlyVariantUpdate(dto);

    if (dto.primaryUnitId !== undefined || dto.baseUnitId !== undefined) {
      await this.validateUnits(dto.primaryUnitId, dto.baseUnitId);
    }

    if (priceOnly && live) {
      const nextPrice = dto.price ?? Number(live.price);
      const nextSellingPrice = dto.sellingPrice ?? Number(live.sellingPrice);
      const nextCostPrice =
        dto.costPrice !== undefined
          ? dto.costPrice
          : live.costPrice !== null
            ? Number(live.costPrice)
            : undefined;
      this.validatePriceInvariant(nextPrice, nextSellingPrice, nextCostPrice);
      await this.productsRepository.updateVariant(variantId, product.id, {
        ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
        ...(dto.sellingPrice !== undefined && {
          sellingPrice: new Prisma.Decimal(dto.sellingPrice),
        }),
        ...(dto.costPrice !== undefined && {
          costPrice: new Prisma.Decimal(dto.costPrice),
        }),
      });
      return;
    }

    const livePrices =
      live &&
      (dto.price !== undefined ||
        dto.sellingPrice !== undefined ||
        dto.costPrice !== undefined)
        ? [this.livePriceWrite(live, dto)]
        : [];

    await this.stageCatalog(
      product,
      (draft) => {
        const current = draft.variants.find(
          (variant) => variant.id === variantId,
        );
        if (!current) {
          throw new NotFoundException('Variant not found');
        }

        const nextPrice = dto.price ?? Number(current.price);
        const nextSellingPrice =
          dto.sellingPrice ?? Number(current.sellingPrice);
        const nextCostPrice =
          dto.costPrice !== undefined
            ? dto.costPrice
            : current.costPrice !== null
              ? Number(current.costPrice)
              : undefined;
        this.validatePriceInvariant(nextPrice, nextSellingPrice, nextCostPrice);
        this.validateCoverageInvariant(
          (dto.coverageArea !== undefined
            ? dto.coverageArea
            : (current.coverageArea ?? undefined)) ?? undefined,
          dto.baseUnitId !== undefined
            ? dto.baseUnitId
            : (current.baseUnitId ?? undefined),
        );

        if (dto.isDefault === false && current.isDefault) {
          const defaults = draft.variants.filter(
            (variant) => variant.isActive && variant.isDefault,
          );
          if (defaults.length <= 1) {
            throw new BadRequestException(
              'Product must keep one active default variant',
            );
          }
        }

        const clearDefault = dto.isDefault === true;
        return {
          ...draft,
          variants: draft.variants.map((variant) => {
            if (variant.id !== variantId) {
              return clearDefault ? { ...variant, isDefault: false } : variant;
            }

            return {
              ...variant,
              ...(dto.sku !== undefined && { sku: dto.sku }),
              ...(dto.name !== undefined && { name: dto.name ?? null }),
              ...(!live && dto.price !== undefined && {
                price: moneyToDraft(dto.price),
              }),
              ...(!live && dto.sellingPrice !== undefined && {
                sellingPrice: moneyToDraft(dto.sellingPrice),
              }),
              ...(!live && dto.costPrice !== undefined && {
                costPrice: moneyToDraft(dto.costPrice),
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
            };
          }),
        };
      },
      { livePrices },
    );
  }

  private livePriceWrite(
    live: OwnedProduct['variants'][number],
    dto: UpdateVariantDto,
  ): LivePriceWrite {
    return {
      variantId: live.id,
      price: moneyToDraft(dto.price ?? live.price),
      sellingPrice: moneyToDraft(dto.sellingPrice ?? live.sellingPrice),
      costPrice:
        dto.costPrice !== undefined
          ? moneyToDraft(dto.costPrice)
          : live.costPrice === null
            ? null
            : moneyToDraft(live.costPrice),
      inventory: null,
    };
  }

  private plannerExisting(product: OwnedProduct) {
    const liveById = new Map(
      product.variants.map((variant) => [variant.id, variant]),
    );
    const working =
      product.status === ProductStatus.ACTIVE && product.catalogDraft
        ? this.readDraft(product.catalogDraft).variants
        : null;
    if (!working) {
      return product.variants.map((variant) => this.liveSnapshot(variant));
    }

    return working.map((variant) => {
      const live = liveById.get(variant.id);
      if (!live) {
        return {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          price: new Prisma.Decimal(variant.price),
          sellingPrice: new Prisma.Decimal(variant.sellingPrice),
          costPrice:
            variant.costPrice === null
              ? null
              : new Prisma.Decimal(variant.costPrice),
          primaryUnitId: variant.primaryUnitId,
          coverageArea: variant.coverageArea,
          baseUnitId: variant.baseUnitId,
          weightKg: variant.weightKg,
          isDefault: variant.isDefault,
          isActive: variant.isActive,
          attributes: variant.attributes,
          inventory: variant.inventory,
        };
      }

      return {
        ...this.liveSnapshot(live),
        sku: variant.sku,
        name: variant.name,
        primaryUnitId: variant.primaryUnitId,
        coverageArea: variant.coverageArea,
        baseUnitId: variant.baseUnitId,
        weightKg: variant.weightKg,
        isDefault: variant.isDefault,
        isActive: variant.isActive,
        attributes: variant.attributes,
      };
    });
  }

  private liveSnapshot(variant: OwnedProduct['variants'][number]) {
    return {
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
    };
  }

  private livePricesFromWrites(
    liveVariants: OwnedProduct['variants'],
    writes: PlannedVariantWrite[],
  ) {
    const liveById = new Map(liveVariants.map((variant) => [variant.id, variant]));
    const prices: LivePriceWrite[] = [];
    for (const write of writes) {
      if (!write.existingId) {
        continue;
      }

      const live = liveById.get(write.existingId);
      if (!live) {
        continue;
      }

      const price = moneyToDraft(write.price);
      const sellingPrice = moneyToDraft(write.sellingPrice);
      const costPrice =
        write.costPrice === null ? null : moneyToDraft(write.costPrice);
      const liveCost =
        live.costPrice === null ? null : moneyToDraft(live.costPrice);
      const priceChanged =
        price !== moneyToDraft(live.price) ||
        sellingPrice !== moneyToDraft(live.sellingPrice) ||
        costPrice !== liveCost;
      if (!priceChanged && !write.inventory) {
        continue;
      }

      prices.push({
        variantId: live.id,
        price,
        sellingPrice,
        costPrice,
        inventory: write.inventory,
      });
    }

    return prices;
  }

  private applyVariantWrites(
    draft: CatalogDraft,
    writes: PlannedVariantWrite[],
    idMap: Record<string, string>,
  ): CatalogDraft {
    const previous = new Map(draft.variants.map((variant) => [variant.id, variant]));
    const variants = writes.map((write) => {
      const earlier = write.existingId
        ? previous.get(write.existingId)
        : undefined;
      const id = write.existingId ?? randomUUID();
      if (write.clientKey && !write.existingId) {
        idMap[write.clientKey] = id;
      }

      const inventory = write.inventory
        ? {
            quantity: write.inventory.quantity,
            lowStockThreshold:
              write.inventory.lowStockThreshold ??
              earlier?.inventory?.lowStockThreshold ??
              5,
            allowBackorder:
              write.inventory.allowBackorder ??
              earlier?.inventory?.allowBackorder ??
              false,
          }
        : (earlier?.inventory ?? {
            quantity: 0,
            lowStockThreshold: 5,
            allowBackorder: false,
          });

      return {
        id,
        sku: write.sku,
        name: write.name,
        price: moneyToDraft(write.price),
        sellingPrice: moneyToDraft(write.sellingPrice),
        costPrice:
          write.costPrice === null ? null : moneyToDraft(write.costPrice),
        primaryUnitId: write.primaryUnitId,
        coverageArea: write.coverageArea,
        baseUnitId: write.baseUnitId,
        weightKg: write.weightKg,
        isDefault: write.isDefault,
        isActive: write.isActive,
        attributes: write.attributes,
        galleryMediaIds: earlier?.galleryMediaIds ?? [],
        inventory,
      };
    });

    return { ...draft, variants };
  }

  private async assertOwnedMedia(vendorId: string, mediaIds: string[]) {
    const owned = await this.mediaService.findOwnedMediaIds(
      { ownerType: MediaOwnerType.VENDOR, ownerId: vendorId },
      mediaIds,
    );
    if (owned.length !== new Set(mediaIds).size) {
      throw new NotFoundException('One or more media records were not found');
    }
  }

  private appendMediaIds(current: string[], incoming: string[]) {
    const next = [...current];
    for (const mediaId of incoming) {
      if (!next.includes(mediaId)) {
        next.push(mediaId);
      }
    }

    return next;
  }

  private assertGalleryReorder(current: string[], mediaIds: string[]) {
    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new BadRequestException('Duplicate media IDs are not allowed');
    }

    if (
      current.length !== mediaIds.length ||
      mediaIds.some((mediaId) => !current.includes(mediaId))
    ) {
      throw new BadRequestException(
        'Reorder must include every gallery media ID exactly once',
      );
    }
  }

  private withDraftFlag<T extends { catalogDraft?: unknown }>(products: T[]) {
    return products.map(({ catalogDraft, ...product }) => ({
      ...product,
      hasCatalogDraft: catalogDraft != null,
    }));
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

  private normalizeProductFacts(dto: ReplaceVariantsDto): ProductFactWrite {
    const specIds = new Set<string>();
    const optionIds = new Set<string>();
    const specs = dto.specs.map((spec) => {
      const value = spec.value.trim();
      if (!value) {
        throw new BadRequestException('Product spec value is empty');
      }
      if (specIds.has(spec.attributeId)) {
        throw new BadRequestException('Duplicate spec attributes are not allowed');
      }
      specIds.add(spec.attributeId);
      return {
        attributeId: spec.attributeId,
        value,
        position: spec.position,
      };
    });

    const options = dto.options.map((option) => {
      if (optionIds.has(option.attributeId)) {
        throw new BadRequestException('Duplicate option attributes are not allowed');
      }
      if (specIds.has(option.attributeId)) {
        throw new BadRequestException(
          'An attribute cannot be both a spec and an option',
        );
      }
      optionIds.add(option.attributeId);
      const seen = new Set<string>();
      const values: string[] = [];
      for (const raw of option.values) {
        const value = raw.trim();
        if (!value) {
          throw new BadRequestException('Option value is empty');
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
          throw new BadRequestException('Duplicate option values are not allowed');
        }
        seen.add(key);
        values.push(value);
      }
      return {
        attributeId: option.attributeId,
        position: option.position,
        values,
      };
    });

    return { specs, options };
  }

  private normalizeVariantOptions(
    variants: ReplaceVariantsDto['variants'],
    facts: ProductFactWrite,
  ) {
    const choices = new Map(
      facts.options.map((option) => [option.attributeId, option.values]),
    );
    return variants.map((variant, index) => {
      const seen = new Set<string>();
      const attributes = variant.attributes.map((attribute) => {
        const allowed = choices.get(attribute.attributeId);
        if (!allowed) {
          throw new BadRequestException(
            `variants[${index}].attributes must be options on this product`,
          );
        }
        if (seen.has(attribute.attributeId)) {
          throw new BadRequestException('Duplicate attribute IDs are not allowed');
        }
        seen.add(attribute.attributeId);
        const match = allowed.find(
          (value) => value.toLowerCase() === attribute.value.trim().toLowerCase(),
        );
        if (!match) {
          throw new BadRequestException(
            `variants[${index}].attributes value is not one of the option choices`,
          );
        }
        return { ...attribute, value: match };
      });
      return { ...variant, attributes };
    });
  }

  private factsDiffer(product: OwnedProduct, facts: ProductFactWrite) {
    const specs = product.specs.map((spec) => ({
      attributeId: spec.attributeId,
      value: spec.value,
      position: spec.position,
    }));
    const options = product.options.map((option) => ({
      attributeId: option.attributeId,
      position: option.position,
      values: option.values.map((value) => value.value),
    }));
    return (
      JSON.stringify(specs) !== JSON.stringify(facts.specs) ||
      JSON.stringify(options) !== JSON.stringify(facts.options)
    );
  }

  private optionChoices(product: OwnedProduct) {
    if (product.catalogDraft) {
      return new Map(
        this.readDraft(product.catalogDraft).options.map((option) => [
          option.attributeId,
          option.values,
        ]),
      );
    }

    return new Map(
      product.options.map((option) => [
        option.attributeId,
        option.values.map((value) => value.value),
      ]),
    );
  }

  private assertOptionAttributes(
    product: OwnedProduct,
    attributes: { attributeId: string }[],
  ) {
    const choices = this.optionChoices(product);
    if (attributes.some((attribute) => !choices.has(attribute.attributeId))) {
      throw new BadRequestException(
        'Attribute is not an option on this product',
      );
    }
  }

  private canonicalOptionAttributes(
    product: OwnedProduct,
    attributes: { attributeId: string; value: string }[],
  ) {
    const choices = this.optionChoices(product);
    return attributes.map((attribute) => {
      const allowed = choices.get(attribute.attributeId);
      if (!allowed) {
        throw new BadRequestException(
          'Attribute is not an option on this product',
        );
      }
      const match = allowed.find(
        (value) => value.toLowerCase() === attribute.value.trim().toLowerCase(),
      );
      if (!match) {
        throw new BadRequestException(
          'Attribute value is not one of the option choices',
        );
      }
      return { ...attribute, value: match };
    });
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

  private async toEditorProduct(product: OwnedProduct) {
    const presented = await this.presentCatalog(product);
    return {
      ...presented.working,
      hasCatalogDraft: presented.hasCatalogDraft,
      published: presented.published,
      submitBlockers: this.buildSubmitBlockers({
        thumbnail: presented.working.thumbnail,
        variants: presented.working.variants,
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

    const presented = await this.presentCatalog(product);
    return {
      ...presented.working,
      hasCatalogDraft: presented.hasCatalogDraft,
      published: presented.published,
    };
  }

  private async presentCatalog(product: OwnedProduct) {
    const { catalogDraft, ...rest } = product;
    const publishedView = this.shapeFacts(await this.withProductMedia(rest));
    if (!catalogDraft) {
      return {
        hasCatalogDraft: false,
        published: null,
        working: publishedView,
      };
    }

    const draft = this.readDraft(catalogDraft);
    const working = await this.toWorkingCopy(product, publishedView, draft);
    return {
      hasCatalogDraft: true,
      published: publishedView,
      working,
    };
  }

  private async toWorkingCopy(
    product: OwnedProduct,
    publishedView: object,
    draft: CatalogDraft,
  ) {
    const base = publishedView as Omit<OwnedProduct, 'catalogDraft' | 'variants'> & {
      media: unknown[];
      thumbnail: unknown;
    };
    const liveById = new Map(
      product.variants.map((variant) => [variant.id, variant]),
    );
    const unitIds = [
      ...new Set(
        draft.variants.flatMap((variant) =>
          [variant.primaryUnitId, variant.baseUnitId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ];
    const attributeIds = [
      ...new Set([
        ...draft.specs.map((spec) => spec.attributeId),
        ...draft.options.map((option) => option.attributeId),
        ...draft.variants.flatMap((variant) =>
          variant.attributes.map((attribute) => attribute.attributeId),
        ),
      ]),
    ];
    const mediaIds = [
      ...new Set(
        [
          draft.thumbnailMediaId,
          ...draft.galleryMediaIds,
          ...draft.variants.flatMap((variant) => variant.galleryMediaIds),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const [units, attributes, category, brand, previews] = await Promise.all([
      this.productsRepository.findUnitsDetailed(unitIds),
      this.productsRepository.findAttributeDetails(attributeIds),
      draft.categoryId === product.categoryId
        ? Promise.resolve(product.category)
        : this.productsRepository.findCategorySummary(draft.categoryId),
      draft.brandId === product.brandId
        ? Promise.resolve(product.brand)
        : draft.brandId
          ? this.productsRepository.findBrandSummary(draft.brandId)
          : Promise.resolve(null),
      this.mediaService.previewMediaLinks(
        mediaIds,
        MediaEntityType.PRODUCT,
        product.id,
        MediaContext.GALLERY,
      ),
    ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const attributeById = new Map(
      attributes.map((attribute) => [attribute.id, attribute]),
    );
    const previewById = new Map(previews.map((link) => [link.mediaId, link]));

    const variants = draft.variants.map((variant) => {
      const live = liveById.get(variant.id);
      const media = variant.galleryMediaIds
        .map((mediaId) => previewById.get(mediaId))
        .filter((link) => link !== undefined)
        .map((link, index) => ({
          ...link,
          entityType: MediaEntityType.PRODUCT_VARIANT,
          entityId: variant.id,
          context: MediaContext.GALLERY,
          sortOrder: index,
        }));
      const attributesForVariant = variant.attributes.map((attribute) => ({
        id: attribute.attributeId,
        attributeId: attribute.attributeId,
        value: attribute.value,
        attribute: attributeById.get(attribute.attributeId) ?? {
          id: attribute.attributeId,
          name: '',
          unit: null,
        },
      }));

      if (live) {
        return {
          ...live,
          sku: variant.sku,
          name: variant.name,
          primaryUnitId: variant.primaryUnitId,
          primaryUnit: unitById.get(variant.primaryUnitId) ?? live.primaryUnit,
          coverageArea: variant.coverageArea,
          baseUnitId: variant.baseUnitId,
          baseUnit: variant.baseUnitId
            ? (unitById.get(variant.baseUnitId) ?? live.baseUnit)
            : null,
          weightKg: variant.weightKg,
          isDefault: variant.isDefault,
          isActive: variant.isActive,
          attributes: attributesForVariant,
          media,
        };
      }

      return {
        id: variant.id,
        productId: product.id,
        sku: variant.sku,
        name: variant.name,
        price: new Prisma.Decimal(variant.price),
        sellingPrice: new Prisma.Decimal(variant.sellingPrice),
        costPrice:
          variant.costPrice === null
            ? null
            : new Prisma.Decimal(variant.costPrice),
        primaryUnitId: variant.primaryUnitId,
        primaryUnit: unitById.get(variant.primaryUnitId) ?? null,
        coverageArea: variant.coverageArea,
        baseUnitId: variant.baseUnitId,
        baseUnit: variant.baseUnitId
          ? (unitById.get(variant.baseUnitId) ?? null)
          : null,
        isDefault: variant.isDefault,
        isActive: variant.isActive,
        weightKg: variant.weightKg,
        createdAt: product.updatedAt,
        updatedAt: product.updatedAt,
        attributes: attributesForVariant,
        inventory: variant.inventory
          ? { ...variant.inventory, updatedAt: product.updatedAt }
          : null,
        media,
      };
    });

    const thumbnail = draft.thumbnailMediaId
      ? (previewById.get(draft.thumbnailMediaId) ?? null)
      : null;

    return {
      ...base,
      name: draft.name,
      description: draft.description,
      shortDescription: draft.shortDescription,
      categoryId: draft.categoryId,
      category: category ?? base.category,
      brandId: draft.brandId,
      brand,
      tags: draft.tags,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      isReturnable: draft.isReturnable,
      returnWindowDays: draft.returnWindowDays,
      specs: draft.specs.map((spec) => ({
        attributeId: spec.attributeId,
        name: attributeById.get(spec.attributeId)?.name ?? '',
        unit: attributeById.get(spec.attributeId)?.unit ?? null,
        value: spec.value,
        position: spec.position,
      })),
      options: draft.options.map((option) => ({
        attributeId: option.attributeId,
        name: attributeById.get(option.attributeId)?.name ?? '',
        unit: attributeById.get(option.attributeId)?.unit ?? null,
        position: option.position,
        values: option.values,
      })),
      thumbnail: thumbnail
        ? {
            ...thumbnail,
            entityType: MediaEntityType.PRODUCT,
            entityId: product.id,
            context: MediaContext.THUMBNAIL,
            isPrimary: true,
            sortOrder: 0,
          }
        : null,
      media: draft.galleryMediaIds
        .map((mediaId) => previewById.get(mediaId))
        .filter((link) => link !== undefined),
      variants,
    };
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
    return this.shapeFacts({
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
    });
  }

  private shapeFacts<T extends object>(product: T) {
    const record = product as T & {
      specs?: Array<{
        attributeId: string;
        value: string;
        position: number;
        name?: string;
        unit?: string | null;
        attribute?: { name: string; unit: string | null } | null;
      }>;
      options?: Array<{
        attributeId: string;
        position: number;
        name?: string;
        unit?: string | null;
        attribute?: { name: string; unit: string | null } | null;
        values: Array<{ value: string } | string>;
      }>;
    };
    return {
      ...record,
      specs: (record.specs ?? []).map((spec) => ({
        attributeId: spec.attributeId,
        name: spec.name ?? spec.attribute?.name ?? '',
        unit: spec.unit ?? spec.attribute?.unit ?? null,
        value: spec.value,
        position: spec.position,
      })),
      options: (record.options ?? []).map((option) => ({
        attributeId: option.attributeId,
        name: option.name ?? option.attribute?.name ?? '',
        unit: option.unit ?? option.attribute?.unit ?? null,
        position: option.position,
        values: option.values.map((value) =>
          typeof value === 'string' ? value : value.value,
        ),
      })),
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
