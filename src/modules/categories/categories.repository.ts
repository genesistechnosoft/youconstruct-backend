import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  description: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

const activeChildrenWhere = {
  isActive: true,
  deletedAt: null,
} as const;

const childrenOneLevel = {
  where: activeChildrenWhere,
  orderBy: { sortOrder: 'asc' as const },
  select: CATEGORY_SELECT,
};

const childrenTwoLevels = {
  where: activeChildrenWhere,
  orderBy: { sortOrder: 'asc' as const },
  select: {
    ...CATEGORY_SELECT,
    children: {
      where: activeChildrenWhere,
      orderBy: { sortOrder: 'asc' as const },
      select: CATEGORY_SELECT,
    },
  },
};

const nonDeletedWhere = {
  deletedAt: null,
} as const;

const adminChildrenOneLevel = {
  where: nonDeletedWhere,
  orderBy: { sortOrder: 'asc' as const },
  select: CATEGORY_SELECT,
};

const adminChildrenTwoLevels = {
  where: nonDeletedWhere,
  orderBy: { sortOrder: 'asc' as const },
  select: {
    ...CATEGORY_SELECT,
    children: {
      where: nonDeletedWhere,
      orderBy: { sortOrder: 'asc' as const },
      select: CATEGORY_SELECT,
    },
  },
};

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        ...CATEGORY_SELECT,
        children: childrenOneLevel,
      },
    });
  }

  findById(id: string) {
    return this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...CATEGORY_SELECT,
        children: adminChildrenOneLevel,
      },
    });
  }

  findActiveById(id: string) {
    return this.prisma.category.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: {
        ...CATEGORY_SELECT,
        children: childrenOneLevel,
      },
    });
  }

  findBySlug(slug: string, excludeId?: string) {
    return this.prisma.category.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  findParentLink(id: string) {
    return this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, parentId: true },
    });
  }

  countActiveChildren(id: string) {
    return this.prisma.category.count({
      where: { parentId: id, isActive: true, deletedAt: null },
    });
  }

  countAnyChildren(id: string) {
    return this.prisma.category.count({
      where: { parentId: id, deletedAt: null },
    });
  }

  findAllForVisibility() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, isActive: true },
    });
  }

  countActiveProducts(id: string) {
    return this.prisma.product.count({
      where: {
        categoryId: id,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  findRoots() {
    return this.prisma.category.findMany({
      where: { parentId: null, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: {
        ...CATEGORY_SELECT,
        children: childrenTwoLevels,
      },
    });
  }

  findAllAdmin(skip?: number, take?: number) {
    return this.prisma.category.findMany({
      where: { parentId: null, ...nonDeletedWhere },
      orderBy: { sortOrder: 'asc' },
      skip,
      take,
      select: {
        ...CATEGORY_SELECT,
        children: adminChildrenTwoLevels,
      },
    });
  }

  countAllAdmin() {
    return this.prisma.category.count({
      where: { parentId: null, ...nonDeletedWhere },
    });
  }

  findSiblingIds(parentId: string | null) {
    return this.prisma.category.findMany({
      where: { parentId, deletedAt: null },
      select: { id: true },
    });
  }

  async findNextSortOrder(parentId: string | null, excludeId?: string) {
    const result = await this.prisma.category.aggregate({
      where: {
        parentId,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      _max: { sortOrder: true },
    });

    return (result._max.sortOrder ?? -1) + 1;
  }

  async reorderSiblings(parentId: string | null, orderedIds: string[]) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await Promise.all(
          orderedIds.map((id, index) =>
            tx.category.update({
              where: { id },
              data: { sortOrder: index },
              select: { id: true },
            }),
          ),
        );

        return tx.category.findMany({
          where: { parentId, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: CATEGORY_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findRootsAdmin() {
    return this.prisma.category.findMany({
      where: { parentId: null, ...nonDeletedWhere },
      orderBy: { sortOrder: 'asc' },
      select: {
        ...CATEGORY_SELECT,
        children: adminChildrenTwoLevels,
      },
    });
  }

  async create(data: Prisma.CategoryCreateInput) {
    try {
      return await this.prisma.category.create({
        data,
        select: CATEGORY_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.CategoryUpdateInput) {
    try {
      return await this.prisma.category.update({
        where: { id },
        data,
        select: CATEGORY_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDelete(id: string) {
    try {
      const existing = await this.prisma.category.findFirst({
        where: { id, deletedAt: null },
        select: { slug: true },
      });
      if (!existing) {
        throw new NotFoundException('Category not found');
      }

      return await this.prisma.category.update({
        where: { id },
        data: {
          slug: `${existing.slug}-deleted-${id}`,
          deletedAt: new Date(),
        },
        select: CATEGORY_SELECT,
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
      throw new ConflictException('Category slug already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Category not found');
    }

    throw error;
  }
}
