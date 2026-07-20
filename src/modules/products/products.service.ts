import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaEntityType,
  MediaOwnerType,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { generateSlug } from '../../common/utils/slug.util';
import { LinkMediaDto } from '../media/dto/link-media.dto';
import { ReorderMediaLinksDto } from '../media/dto/reorder-media-links.dto';
import { MediaService } from '../media/media.service';
import { BrowseProductsDto } from './dto/browse-products.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ProductFiltersDto } from './dto/product-filters.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { SetAttributesDto } from './dto/set-attributes.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly mediaService: MediaService,
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
      data: await this.withProductMedia(product),
    };
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const vendorId = await this.getVendorId(userId);
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

    const product = await this.productsRepository.create({
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
      tags: dto.tags ?? [],
      metaTitle: dto.metaTitle,
      metaDescription: dto.metaDescription,
    });

    return { message: 'Product created successfully', data: product };
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

    if (dto.name !== undefined) {
      const slug = generateSlug(dto.name);
      const existingSlug = await this.productsRepository.findBySlug(
        slug,
        productId,
      );
      if (existingSlug) {
        throw new ConflictException('Product slug already exists');
      }
    }

    const isReturnable = dto.isReturnable ?? existing.isReturnable;
    const returnWindowDays = dto.returnWindowDays ?? existing.returnWindowDays;
    this.validateReturnInvariant(isReturnable, returnWindowDays ?? undefined);

    const product = await this.productsRepository.update(productId, {
      ...(dto.name !== undefined && {
        name: dto.name,
        slug: generateSlug(dto.name),
      }),
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
      ...(dto.tags !== undefined && { tags: dto.tags }),
      ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
      ...(dto.metaDescription !== undefined && {
        metaDescription: dto.metaDescription,
      }),
    });

    return { message: 'Product updated successfully', data: product };
  }

  async submitForApproval(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.INACTIVE
    ) {
      throw new BadRequestException(
        'Only draft or rejected products can be submitted for approval',
      );
    }

    await this.validateProductCanGoLive(productId);

    const submitted =
      await this.productsRepository.submitForApproval(productId);
    return { message: 'Product submitted for approval', data: submitted };
  }

  async deleteProduct(userId: string, productId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
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

    const variant = await this.productsRepository.createVariant({
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

    return { message: 'Variant added successfully', data: variant };
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

    const updatedVariant = await this.productsRepository.updateVariant(
      variantId,
      productId,
      {
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
      },
    );

    return { message: 'Variant updated successfully', data: updatedVariant };
  }

  async deleteVariant(userId: string, productId: string, variantId: string) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);
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
    return { message: 'Variant deleted successfully', data: null };
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

    const inventory = await this.productsRepository.updateInventory(variantId, {
      quantity: dto.quantity,
      ...(dto.lowStockThreshold !== undefined && {
        lowStockThreshold: dto.lowStockThreshold,
      }),
      ...(dto.allowBackorder !== undefined && {
        allowBackorder: dto.allowBackorder,
      }),
    });

    return { message: 'Inventory updated successfully', data: inventory };
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
    await this.validateAttributePayload(dto.attributes);

    const attributes = await this.productsRepository.setVariantAttributes(
      variantId,
      dto.attributes,
    );

    return {
      message: 'Variant attributes updated successfully',
      data: attributes,
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

    return this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT,
      productId,
    );
  }

  async linkProductGalleryMedia(
    userId: string,
    productId: string,
    dto: LinkMediaDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    return this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );
  }

  async reorderProductGalleryMedia(
    userId: string,
    productId: string,
    dto: ReorderMediaLinksDto,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    return this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT,
      productId,
      dto,
    );
  }

  async unlinkProductGalleryMedia(
    userId: string,
    productId: string,
    mediaId: string,
  ) {
    const product = await this.verifyProductOwnership(userId, productId);
    this.ensureVendorCanMutateProduct(product.status);

    return this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT,
      productId,
      mediaId,
    );
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

    return this.mediaService.uploadVendorMediaForEntity(
      actorUserId,
      product.vendorId,
      file,
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
    );
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

    return this.mediaService.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: product.vendorId },
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );
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

    return this.mediaService.reorderEntityMedia(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      dto,
    );
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

    return this.mediaService.unlinkMediaFromEntity(
      MediaEntityType.PRODUCT_VARIANT,
      variantId,
      mediaId,
    );
  }

  async browseProducts(filters: BrowseProductsDto) {
    const { items, total } = await this.productsRepository.findPublic(filters);

    return {
      message: 'Products fetched successfully',
      data: await this.withProductsMedia(items),
      meta: this.getMeta(filters.page, filters.limit, total),
    };
  }

  async getProductDetail(id: string) {
    const product = await this.productsRepository.findPublicById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product fetched successfully',
      data: await this.withProductMedia(product),
    };
  }

  async getAllProducts(filters: ProductFiltersDto) {
    const { items, total } =
      await this.productsRepository.findAllAdmin(filters);

    return {
      message: 'Products fetched successfully',
      data: await this.withProductsMedia(items),
      meta: this.getMeta(filters.page, filters.limit, total),
    };
  }

  async getAdminProduct(id: string) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      message: 'Product fetched successfully',
      data: await this.withProductMedia(product),
    };
  }

  async approveProduct(id: string) {
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

    const product = await this.productsRepository.update(id, {
      status: ProductStatus.ACTIVE,
      rejectionNote: null,
    });

    return { message: 'Product approved successfully', data: product };
  }

  async rejectProduct(id: string, dto: RejectProductDto) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (existing.status !== ProductStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only pending products can be rejected');
    }

    const product = await this.productsRepository.update(id, {
      status: ProductStatus.DRAFT,
      rejectionNote: dto.rejectionNote,
    });

    return { message: 'Product rejected successfully', data: product };
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
    const [activeVariants, defaultVariants, galleryImages] = await Promise.all([
      this.productsRepository.countActiveVariants(productId),
      this.productsRepository.countActiveDefaultVariants(productId),
      this.mediaService.countReadyGalleryLinks(
        MediaEntityType.PRODUCT,
        productId,
      ),
    ]);

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

    if (galleryImages === 0) {
      throw new BadRequestException(
        'Product must have at least one ready gallery image',
      );
    }
  }

  private ensureVendorCanMutateProduct(status: ProductStatus) {
    if (status === ProductStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Pending products cannot be changed until reviewed',
      );
    }

    if (status === ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'Active products cannot be changed without review',
      );
    }
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

  private async withProductsMedia<T extends { id: string }>(products: T[]) {
    return Promise.all(
      products.map((product) => this.withProductMedia(product)),
    );
  }

  private async withProductMedia<
    T extends { id: string; variants?: { id: string }[] },
  >(product: T) {
    const media = await this.mediaService.getEntityGallery(
      MediaEntityType.PRODUCT,
      product.id,
    );

    if (!product.variants) {
      return { ...product, media };
    }

    const variants = await Promise.all(
      product.variants.map(async (variant) => ({
        ...variant,
        media: await this.mediaService.getEntityGallery(
          MediaEntityType.PRODUCT_VARIANT,
          variant.id,
        ),
      })),
    );

    return { ...product, media, variants };
  }
}
