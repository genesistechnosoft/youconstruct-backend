import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { PrismaService } from '../../prisma/prisma.service';

const CART_ITEM_SELECT = {
  id: true,
  cartId: true,
  variantId: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      sellingPrice: true,
      isActive: true,
      deletedAt: true,
      weightKg: true,
      coverageArea: true,
      primaryUnit: {
        select: { id: true, symbol: true, name: true },
      },
      inventory: {
        select: {
          quantity: true,
          allowBackorder: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          status: true,
          deletedAt: true,
          vendorId: true,
          vendor: {
            select: {
              id: true,
              businessName: true,
              isApproved: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCart(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { id: true, userId: true },
    });
  }

  findCartWithItems(userId: string) {
    return this.prisma.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: CART_ITEM_SELECT,
        },
      },
    });
  }

  findVariantForCart(variantId: string) {
    return this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        deletedAt: null,
        isActive: true,
        product: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
          vendor: {
            isApproved: true,
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        sellingPrice: true,
        product: {
          select: {
            id: true,
            name: true,
            vendorId: true,
          },
        },
        inventory: {
          select: {
            quantity: true,
            allowBackorder: true,
          },
        },
        primaryUnit: {
          select: { symbol: true },
        },
      },
    });
  }

  findCartItem(cartId: string, variantId: string) {
    return this.prisma.cartItem.findUnique({
      where: {
        cartId_variantId: { cartId, variantId },
      },
      select: {
        id: true,
        quantity: true,
        variantId: true,
        cartId: true,
      },
    });
  }

  async upsertCartItem(cartId: string, variantId: string, quantity: number) {
    const existing = await this.findCartItem(cartId, variantId);
    if (existing) {
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
        select: CART_ITEM_SELECT,
      });
    }

    return this.prisma.cartItem.create({
      data: { cartId, variantId, quantity },
      select: CART_ITEM_SELECT,
    });
  }

  updateCartItemQuantity(cartId: string, variantId: string, quantity: number) {
    return this.prisma.cartItem.update({
      where: { cartId_variantId: { cartId, variantId } },
      data: { quantity },
      select: CART_ITEM_SELECT,
    });
  }

  async deleteCartItem(cartId: string, variantId: string) {
    try {
      await this.prisma.cartItem.delete({
        where: { cartId_variantId: { cartId, variantId } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Cart item not found');
      }
      throw error;
    }
  }

  async clearCartItems(cartId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  assertStockAvailable(
    quantity: number,
    inventory: { quantity: number; allowBackorder: boolean } | null,
  ) {
    if (!inventory) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INSUFFICIENT_STOCK,
        'Variant inventory not configured',
      );
    }
    if (!inventory.allowBackorder && quantity > inventory.quantity) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INSUFFICIENT_STOCK,
        'Insufficient stock for this variant',
      );
    }
  }
}
