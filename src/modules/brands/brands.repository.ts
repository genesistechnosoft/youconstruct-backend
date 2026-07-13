import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
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

  findAll(includeInactive = false) {
    return this.prisma.brand.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
      select: BRAND_SELECT,
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
      return await this.prisma.brand.update({
        where: { id },
        data: { deletedAt: new Date() },
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
