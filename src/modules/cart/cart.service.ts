import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { ShippingQuoteService } from '../orders/shipping-quote.service';
import { CartRepository } from './cart.repository';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly shippingQuoteService: ShippingQuoteService,
  ) {}

  async getCart(userId: string) {
    await this.cartRepository.ensureCart(userId);
    const cart = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart fetched successfully',
      data: this.toCartResponse(cart),
    };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const cart = await this.cartRepository.ensureCart(userId);
    const variant = await this.cartRepository.findVariantForCart(dto.variantId);
    if (!variant) {
      throw new BadRequestException(
        'Variant is unavailable or vendor is not approved',
      );
    }

    const existing = await this.cartRepository.findCartItem(
      cart.id,
      dto.variantId,
    );
    const nextQty = (existing?.quantity ?? 0) + dto.quantity;
    this.cartRepository.assertStockAvailable(nextQty, variant.inventory);

    await this.cartRepository.upsertCartItem(
      cart.id,
      dto.variantId,
      dto.quantity,
    );

    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Item added to cart',
      data: this.toCartResponse(refreshed),
    };
  }

  async updateItem(userId: string, variantId: string, dto: UpdateCartItemDto) {
    const cart = await this.cartRepository.ensureCart(userId);
    const existing = await this.cartRepository.findCartItem(cart.id, variantId);
    if (!existing) {
      throw new NotFoundException('Cart item not found');
    }

    const variant = await this.cartRepository.findVariantForCart(variantId);
    if (!variant) {
      throw new BadRequestException(
        'Variant is unavailable or vendor is not approved',
      );
    }

    this.cartRepository.assertStockAvailable(dto.quantity, variant.inventory);
    await this.cartRepository.updateCartItemQuantity(
      cart.id,
      variantId,
      dto.quantity,
    );

    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart item updated',
      data: this.toCartResponse(refreshed),
    };
  }

  async removeItem(userId: string, variantId: string) {
    const cart = await this.cartRepository.ensureCart(userId);
    await this.cartRepository.deleteCartItem(cart.id, variantId);
    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart item removed',
      data: this.toCartResponse(refreshed),
    };
  }

  async clearCart(userId: string) {
    const cart = await this.cartRepository.ensureCart(userId);
    await this.cartRepository.clearCartItems(cart.id);
    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart cleared',
      data: this.toCartResponse(refreshed),
    };
  }

  async shippingQuote(userId: string, addressId: string) {
    await this.cartRepository.ensureCart(userId);
    const quote = await this.shippingQuoteService.quoteForCart(
      userId,
      addressId,
    );
    return {
      message: 'Shipping quote calculated',
      data: quote,
    };
  }

  private toCartResponse(
    cart: Awaited<ReturnType<CartRepository['findCartWithItems']>>,
  ) {
    if (!cart) {
      return { id: null, items: [], itemCount: 0, merchandiseSubtotal: '0.00' };
    }

    let merchandiseSubtotal = new Prisma.Decimal(0);
    const items = cart.items.map((item) => {
      const lineTotal = item.variant.sellingPrice.mul(item.quantity);
      merchandiseSubtotal = merchandiseSubtotal.add(lineTotal);

      return {
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        sellingPrice: item.variant.sellingPrice.toString(),
        lineTotal: lineTotal.toString(),
        productName: item.variant.product.name,
        variantName: item.variant.name,
        sku: item.variant.sku,
        unitSymbol: item.variant.primaryUnit.symbol,
        availableQuantity: item.variant.inventory?.quantity ?? 0,
        allowBackorder: item.variant.inventory?.allowBackorder ?? false,
        vendorId: item.variant.product.vendorId,
        vendorName: item.variant.product.vendor.businessName,
        productId: item.variant.product.id,
      };
    });

    return {
      id: cart.id,
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      merchandiseSubtotal: merchandiseSubtotal.toFixed(2),
      updatedAt: cart.updatedAt,
    };
  }
}
