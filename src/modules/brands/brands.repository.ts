import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeInactive = false, skip?: number, take?: number) {
    return this.prisma.brand.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
      skip,
      take,
      select: BRAND_SELECT,
    });
  }

  countAll(includeInactive = false) {
    return this.prisma.brand.count({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
    });
  }

  findById(id: string) {
    return this.prisma.brand.findFirst({
      where: { id, deletedAt: null },
      select: BRAND_SELECT,
    });
  }

  findActiveById(id: string) {
    return this.prisma.brand.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: BRAND_SELECT,
    });
  }

  findBySlug(slug: string, excludeId?: string) {
    return this.prisma.brand.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  countActiveProducts(id: string) {
    return this.prisma.product.count({
      where: {
        brandId: id,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  async create(data: Prisma.BrandCreateInput) {
    try {
      return await this.prisma.brand.create({
        data,
        select: BRAND_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.BrandUpdateInput) {
    try {
      return await this.prisma.brand.update({
        where: { id },
        data,
        select: BRAND_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDelete(id: string) {
    try {
      const existing = await this.prisma.brand.findFirst({
        where: { id, deletedAt: null },
        select: { slug: true },
      });
      if (!existing) {
        throw new NotFoundException('Brand not found');
      }

      return await this.prisma.brand.update({
        where: { id },
        data: {
          slug: `${existing.slug}-deleted-${id}`,
          deletedAt: new Date(),
        },
        select: BRAND_SELECT,
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
      throw new ConflictException('Brand slug already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Brand not found');
    }

    throw error;
  }
}
