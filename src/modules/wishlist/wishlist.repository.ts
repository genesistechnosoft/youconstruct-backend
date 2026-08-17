import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

const WISHLIST_ITEM_SELECT = {
  id: true,
  userId: true,
  productId: true,
  variantId: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      deletedAt: true,
    },
  },
  variant: {
    select: {
      id: true,
      name: true,
      sku: true,
      sellingPrice: true,
      isActive: true,
      deletedAt: true,
    },
  },
} as const;

@Injectable()
export class WishlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByUser(userId: string) {
    return this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: WISHLIST_ITEM_SELECT,
    });
  }

  findByUserAndProduct(
    userId: string,
    productId: string,
    variantId?: string | null,
  ) {
    return this.prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId,
        variantId: variantId ?? null,
      },
      select: WISHLIST_ITEM_SELECT,
    });
  }

  findById(id: string) {
    return this.prisma.wishlistItem.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
  }

  async create(data: {
    userId: string;
    productId: string;
    variantId?: string | null;
  }) {
    try {
      return await this.prisma.wishlistItem.create({
        data: {
          userId: data.userId,
          productId: data.productId,
          variantId: data.variantId ?? null,
        },
        select: WISHLIST_ITEM_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Item already in wishlist');
      }
      throw error;
    }
  }

  async delete(id: string) {
    try {
      return await this.prisma.wishlistItem.delete({
        where: { id },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Wishlist item not found');
      }
      throw error;
    }
  }

  findActiveProduct(productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        deletedAt: null,
        vendor: { isApproved: true, deletedAt: null },
      },
      select: { id: true },
    });
  }

  findActiveVariant(variantId: string, productId: string) {
    return this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        productId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
  }
}
