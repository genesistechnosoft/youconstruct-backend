import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaEntityType } from '../../../generated/prisma/client.js';
import { formatMoney } from '../../common/utils/money.util';
import { MediaService } from '../media/media.service';
import { AddWishlistItemDto } from './dto/add-wishlist-item.dto';
import { WishlistRepository } from './wishlist.repository';

@Injectable()
export class WishlistService {
  constructor(
    private readonly wishlistRepository: WishlistRepository,
    private readonly mediaService: MediaService,
  ) {}

  async getWishlist(userId: string) {
    const items = await this.wishlistRepository.findAllByUser(userId);
    const productIds = [...new Set(items.map((i) => i.productId))];
    const primaryImages = await this.mediaService.getPrimaryImagesForEntities(
      MediaEntityType.PRODUCT,
      productIds,
    );

    const data = items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      product: {
        id: item.product.id,
        name: item.product.name,
        slug: item.product.slug,
        status: item.product.status,
        primaryImage: primaryImages.get(item.product.id) ?? null,
      },
      variant: item.variant
        ? {
            id: item.variant.id,
            name: item.variant.name ?? item.product.name,
            sku: item.variant.sku,
            sellingPrice: formatMoney(item.variant.sellingPrice),
          }
        : null,
    }));

    return { message: 'Wishlist fetched successfully', data };
  }

  async addItem(userId: string, dto: AddWishlistItemDto) {
    const product = await this.wishlistRepository.findActiveProduct(
      dto.productId,
    );
    if (!product) {
      throw new BadRequestException(
        'Product is not available or vendor is not approved',
      );
    }

    if (dto.variantId) {
      const variant = await this.wishlistRepository.findActiveVariant(
        dto.variantId,
        dto.productId,
      );
      if (!variant) {
        throw new BadRequestException(
          'Variant not found or does not belong to this product',
        );
      }
    }

    const existing = await this.wishlistRepository.findByUserAndProduct(
      userId,
      dto.productId,
      dto.variantId ?? null,
    );
    if (existing) {
      return {
        message: 'Item already in wishlist',
        data: this.mapItem(existing),
      };
    }

    const item = await this.wishlistRepository.create({
      userId,
      productId: dto.productId,
      variantId: dto.variantId ?? null,
    });

    return { message: 'Item added to wishlist', data: this.mapItem(item) };
  }

  async removeItem(userId: string, id: string) {
    const item = await this.wishlistRepository.findById(id);
    if (!item) {
      throw new NotFoundException('Wishlist item not found');
    }
    if (item.userId !== userId) {
      throw new ForbiddenException('You do not own this wishlist item');
    }

    await this.wishlistRepository.delete(id);
    return { message: 'Item removed from wishlist', data: null };
  }

  private mapItem(item: {
    id: string;
    createdAt: Date;
    product: { id: string; name: string; slug: string; status: string };
    variant: {
      id: string;
      name: string | null;
      sku: string;
      sellingPrice: Parameters<typeof formatMoney>[0];
    } | null;
  }) {
    return {
      id: item.id,
      createdAt: item.createdAt,
      product: {
        id: item.product.id,
        name: item.product.name,
        slug: item.product.slug,
        status: item.product.status,
      },
      variant: item.variant
        ? {
            id: item.variant.id,
            name: item.variant.name ?? item.product.name,
            sku: item.variant.sku,
            sellingPrice: formatMoney(item.variant.sellingPrice),
          }
        : null,
    };
  }
}
