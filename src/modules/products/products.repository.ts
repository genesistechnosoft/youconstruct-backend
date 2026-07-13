import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

export const PRODUCT_SELECT = {
  id: true,
  vendorId: true,
  categoryId: true,
  brandId: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  status: true,
  isReturnable: true,
  returnWindowDays: true,
  tags: true,
  metaTitle: true,
  metaDescription: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const PRODUCT_REVIEW_SELECT = {
  ...PRODUCT_SELECT,
  rejectionNote: true,
} as const;

const PUBLIC_PRODUCT_SELECT = {
  id: true,
  categoryId: true,
  brandId: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  status: true,
  isReturnable: true,
  returnWindowDays: true,
  tags: true,
  metaTitle: true,
  metaDescription: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
} as const;

const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
} as const;

const UNIT_SELECT = {
  id: true,
  name: true,
  symbol: true,
  code: true,
  type: true,
} as const;

const INVENTORY_SELECT = {
  quantity: true,
  lowStockThreshold: true,
  allowBackorder: true,
  updatedAt: true,
} as const;

const ATTRIBUTE_DEFINITION_SELECT = {
  id: true,
  name: true,
  unit: true,
} as const;

const VARIANT_ATTRIBUTE_SELECT = {
  id: true,
  attributeId: true,
  value: true,
  attribute: {
    select: ATTRIBUTE_DEFINITION_SELECT,
  },
} as const;

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  name: true,
  price: true,
  sellingPrice: true,
  costPrice: true,
  primaryUnitId: true,
  coverageArea: true,
  baseUnitId: true,
  isDefault: true,
  isActive: true,
  weightKg: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VARIANT_DETAIL_SELECT = {
  ...VARIANT_SELECT,
  attributes: {
    select: VARIANT_ATTRIBUTE_SELECT,
  },
  inventory: {
    select: INVENTORY_SELECT,
  },
  primaryUnit: {
    select: UNIT_SELECT,
  },
  baseUnit: {
    select: UNIT_SELECT,
  },
} as const;

const PUBLIC_VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  price: true,
  sellingPrice: true,
  primaryUnitId: true,
  coverageArea: true,
  baseUnitId: true,
  isDefault: true,
  isActive: true,
  weightKg: true,
  createdAt: true,
  updatedAt: true,
  attributes: {
    select: VARIANT_ATTRIBUTE_SELECT,
  },
  primaryUnit: {
    select: UNIT_SELECT,
  },
  baseUnit: {
    select: UNIT_SELECT,
  },
} as const;

const variantOrderBy: Prisma.ProductVariantOrderByWithRelationInput[] = [
  { isDefault: Prisma.SortOrder.desc },
  { createdAt: Prisma.SortOrder.asc },
];

const productListSelect = {
  ...PRODUCT_REVIEW_SELECT,
  category: {
    select: CATEGORY_SELECT,
  },
  brand: {
    select: BRAND_SELECT,
  },
  _count: {
    select: {
      variants: {
        where: { deletedAt: null },
      },
    },
  },
} as const;

const publicProductListSelect = {
  ...PUBLIC_PRODUCT_SELECT,
  category: {
    select: CATEGORY_SELECT,
  },
  brand: {
    select: BRAND_SELECT,
  },
  _count: {
    select: {
      variants: {
        where: { isActive: true, deletedAt: null },
      },
    },
  },
} as const;

const publicProductDetailSelect = {
  ...PUBLIC_PRODUCT_SELECT,
  category: {
    select: CATEGORY_SELECT,
  },
  brand: {
    select: BRAND_SELECT,
  },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: variantOrderBy,
    select: PUBLIC_VARIANT_SELECT,
  },
} as const;

const productDetailSelect = {
  ...PRODUCT_REVIEW_SELECT,
  category: {
    select: CATEGORY_SELECT,
  },
  brand: {
    select: BRAND_SELECT,
  },
  variants: {
    where: { deletedAt: null },
    orderBy: variantOrderBy,
    select: VARIANT_DETAIL_SELECT,
  },
} as const;

export interface ProductFilters {
  status?: ProductStatus;
  page?: number;
  limit?: number;
}

export interface BrowseProductFilters {
  categoryId?: string;
  brandId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface VariantAttributeInput {
  attributeId: string;
  value: string;
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findVendorByUserId(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, isApproved: true, deletedAt: null },
      select: { id: true },
    });
  }

  findApprovedVendorById(id: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id, isApproved: true, deletedAt: null },
      select: { id: true },
    });
  }

  async findByVendor(vendorId: string, filters: ProductFilters) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.ProductWhereInput = {
      vendorId,
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: productListSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  findByVendorAndId(vendorId: string, id: string) {
    return this.prisma.product.findFirst({
      where: { id, vendorId, deletedAt: null },
      select: productDetailSelect,
    });
  }

  async findPublic(filters: BrowseProductFilters) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      deletedAt: null,
      vendor: { isApproved: true, deletedAt: null },
      category: { isActive: true, deletedAt: null },
      OR: [{ brandId: null }, { brand: { isActive: true, deletedAt: null } }],
      ...(filters.categoryId && { categoryId: filters.categoryId }),
      ...(filters.brandId && { brandId: filters.brandId }),
      ...(filters.search && {
        name: { contains: filters.search, mode: 'insensitive' },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: publicProductListSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  findPublicById(id: string) {
    return this.prisma.product.findFirst({
      where: {
        id,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
        vendor: { isApproved: true, deletedAt: null },
        category: { isActive: true, deletedAt: null },
        OR: [{ brandId: null }, { brand: { isActive: true, deletedAt: null } }],
      },
      select: publicProductDetailSelect,
    });
  }

  async findAllAdmin(filters: ProductFilters) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: productListSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total };
  }

  findById(id: string) {
    return this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: productDetailSelect,
    });
  }

  findBySlug(slug: string, excludeId?: string) {
    return this.prisma.product.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  findCategoryById(id: string) {
    return this.prisma.category.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  findBrandById(id: string) {
    return this.prisma.brand.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  findUnitById(id: string) {
    return this.prisma.unit.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
  }

  findAttributeDefinitionsByIds(ids: string[]) {
    return this.prisma.attributeDefinition.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
  }

  async create(data: Prisma.ProductUncheckedCreateInput) {
    try {
      return await this.prisma.product.create({
        data,
        select: PRODUCT_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.ProductUncheckedUpdateInput) {
    try {
      return await this.prisma.product.update({
        where: { id },
        data,
        select: PRODUCT_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDelete(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const deletedAt = new Date();
        const existing = await tx.product.findFirst({
          where: { id, deletedAt: null },
          select: { slug: true },
        });
        if (!existing) {
          throw new NotFoundException('Product not found');
        }

        const product = await tx.product.update({
          where: { id },
          data: { slug: `${existing.slug}-deleted-${id}`, deletedAt },
          select: PRODUCT_REVIEW_SELECT,
        });

        const variants = await tx.productVariant.findMany({
          where: { productId: id, deletedAt: null },
          select: { id: true, sku: true },
        });

        await Promise.all(
          variants.map((variant) =>
            tx.productVariant.update({
              where: { id: variant.id },
              data: {
                sku: `${variant.sku}-deleted-${variant.id}`,
                deletedAt,
                isActive: false,
              },
              select: { id: true },
            }),
          ),
        );

        return product;
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async submitForApproval(id: string) {
    try {
      return await this.prisma.product.update({
        where: { id },
        data: { status: ProductStatus.PENDING_APPROVAL },
        select: PRODUCT_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countActiveVariants(productId: string) {
    return this.prisma.productVariant.count({
      where: { productId, isActive: true, deletedAt: null },
    });
  }

  countActiveDefaultVariants(productId: string) {
    return this.prisma.productVariant.count({
      where: { productId, isDefault: true, isActive: true, deletedAt: null },
    });
  }

  async createVariant(data: Prisma.ProductVariantUncheckedCreateInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.productVariant.updateMany({
            where: { productId: data.productId, deletedAt: null },
            data: { isDefault: false },
          });
        }

        const variant = await tx.productVariant.create({
          data,
          select: VARIANT_SELECT,
        });

        await tx.productInventory.create({
          data: { variantId: variant.id, quantity: 0 },
        });

        return tx.productVariant.findFirst({
          where: { id: variant.id },
          select: VARIANT_DETAIL_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findVariant(variantId: string, productId: string) {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
      select: VARIANT_DETAIL_SELECT,
    });
  }

  findVariantBySku(sku: string, excludeId?: string) {
    return this.prisma.productVariant.findFirst({
      where: {
        sku,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  async updateVariant(
    id: string,
    productId: string,
    data: Prisma.ProductVariantUncheckedUpdateInput,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault === true) {
          await tx.productVariant.updateMany({
            where: { productId, id: { not: id }, deletedAt: null },
            data: { isDefault: false },
          });
        }

        return tx.productVariant.update({
          where: { id },
          data,
          select: VARIANT_DETAIL_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDeleteVariant(id: string) {
    try {
      const existing = await this.prisma.productVariant.findFirst({
        where: { id, deletedAt: null },
        select: { sku: true },
      });
      if (!existing) {
        throw new NotFoundException('Variant not found');
      }

      return await this.prisma.productVariant.update({
        where: { id },
        data: {
          sku: `${existing.sku}-deleted-${id}`,
          deletedAt: new Date(),
          isActive: false,
        },
        select: VARIANT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateInventory(
    variantId: string,
    data: Prisma.ProductInventoryUncheckedUpdateInput,
  ) {
    try {
      return await this.prisma.productInventory.update({
        where: { variantId },
        data,
        select: INVENTORY_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findVariantAttributes(variantId: string) {
    return this.prisma.variantAttribute.findMany({
      where: { variantId },
      select: VARIANT_ATTRIBUTE_SELECT,
    });
  }

  async setVariantAttributes(
    variantId: string,
    attributes: VariantAttributeInput[],
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.variantAttribute.deleteMany({ where: { variantId } });

        if (attributes.length > 0) {
          await tx.variantAttribute.createMany({
            data: attributes.map((attribute) => ({
              variantId,
              attributeId: attribute.attributeId,
              value: attribute.value,
            })),
          });
        }

        return tx.variantAttribute.findMany({
          where: { variantId },
          select: VARIANT_ATTRIBUTE_SELECT,
        });
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
      throw new ConflictException('Product already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Product not found');
    }

    throw error;
  }
}
