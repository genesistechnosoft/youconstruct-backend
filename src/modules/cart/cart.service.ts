import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaEntityType, Prisma } from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { formatMoney } from '../../common/utils/money.util';
import { CouponsService } from '../coupons/coupons.service';
import { MediaService } from '../media/media.service';
import { ShippingQuoteService } from '../orders/shipping-quote.service';
import { CartRepository } from './cart.repository';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { PreviewCouponDto } from '../coupons/dto/coupon.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly shippingQuoteService: ShippingQuoteService,
    private readonly mediaService: MediaService,
    private readonly couponsService: CouponsService,
  ) {}

  async getCart(userId: string) {
    await this.cartRepository.ensureCart(userId);
    const cart = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart fetched successfully',
      data: await this.toCartResponse(cart),
    };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const cart = await this.cartRepository.ensureCart(userId);
    const variant = await this.cartRepository.findVariantForCart(dto.variantId);
    if (!variant) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INSUFFICIENT_STOCK,
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
      data: await this.toCartResponse(refreshed),
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
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.INSUFFICIENT_STOCK,
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
      data: await this.toCartResponse(refreshed),
    };
  }

  async removeItem(userId: string, variantId: string) {
    const cart = await this.cartRepository.ensureCart(userId);
    await this.cartRepository.deleteCartItem(cart.id, variantId);
    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart item removed',
      data: await this.toCartResponse(refreshed),
    };
  }

  async clearCart(userId: string) {
    const cart = await this.cartRepository.ensureCart(userId);
    await this.cartRepository.clearCartItems(cart.id);
    const refreshed = await this.cartRepository.findCartWithItems(userId);
    return {
      message: 'Cart cleared',
      data: await this.toCartResponse(refreshed),
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

  async previewCoupon(userId: string, dto: PreviewCouponDto) {
    await this.cartRepository.ensureCart(userId);
    const cart = await this.cartRepository.findCartWithItems(userId);
    if (!cart || cart.items.length === 0) {
      throw domainBadRequest(DOMAIN_ERROR_CODES.CART_EMPTY, 'Cart is empty');
    }

    const lines = cart.items.map((item) => ({
      vendorId: item.variant.product.vendorId,
      lineTotal: item.variant.sellingPrice.mul(item.quantity),
    }));

    const evaluation = await this.couponsService.evaluateCoupon(
      dto.couponCode,
      userId,
      lines,
    );

    return {
      message: 'Coupon preview calculated',
      data: {
        code: evaluation.code,
        scope: evaluation.scope,
        eligibleSubtotal: formatMoney(evaluation.eligibleSubtotal),
        discountAmount: formatMoney(evaluation.discountAmount),
      },
    };
  }

  private async toCartResponse(
    cart: Awaited<ReturnType<CartRepository['findCartWithItems']>>,
  ) {
    if (!cart) {
      return { id: null, items: [], itemCount: 0, merchandiseSubtotal: '0.00' };
    }

    const productIds = cart.items.map((item) => item.variant.product.id);
    const variantIds = cart.items.map((item) => item.variantId);
    const [productImages, variantImages] = await Promise.all([
      this.mediaService.getPrimaryImagesForEntities(
        MediaEntityType.PRODUCT,
        productIds,
      ),
      this.mediaService.getPrimaryImagesForEntities(
        MediaEntityType.PRODUCT_VARIANT,
        variantIds,
      ),
    ]);

    let merchandiseSubtotal = new Prisma.Decimal(0);
    const items = cart.items.map((item) => {
      const lineTotal = item.variant.sellingPrice.mul(item.quantity);
      merchandiseSubtotal = merchandiseSubtotal.add(lineTotal);
      const primaryImage =
        variantImages.get(item.variantId) ??
        productImages.get(item.variant.product.id) ??
        null;

      return {
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        sellingPrice: formatMoney(item.variant.sellingPrice),
        lineTotal: formatMoney(lineTotal),
        productName: item.variant.product.name,
        variantName: item.variant.name,
        sku: item.variant.sku,
        unitSymbol: item.variant.primaryUnit.symbol,
        availableQuantity: item.variant.inventory?.quantity ?? 0,
        allowBackorder: item.variant.inventory?.allowBackorder ?? false,
        vendorId: item.variant.product.vendorId,
        vendorName: item.variant.product.vendor.businessName,
        productId: item.variant.product.id,
        primaryImage,
      };
    });

    return {
      id: cart.id,
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      merchandiseSubtotal: formatMoney(merchandiseSubtotal),
      updatedAt: cart.updatedAt,
    };
  }
}
