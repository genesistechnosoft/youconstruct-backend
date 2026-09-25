import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { formatMoney } from '../../common/utils/money.util';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { MediaService } from '../media/media.service';
import { ProductsService } from '../products/products.service';
import { VendorStoreService } from '../vendor-store/vendor-store.service';
import {
  PublicVendorListQueryDto,
  VendorAnalyticsQueryDto,
  VendorStorefrontQueryDto,
} from './dto/vendor-dashboard.dto';
import { VendorDashboardRepository } from './vendor-dashboard.repository';

@Injectable()
export class VendorDashboardService {
  constructor(
    private readonly vendorDashboardRepository: VendorDashboardRepository,
    private readonly vendorStoreService: VendorStoreService,
    private readonly productsService: ProductsService,
    private readonly mediaService: MediaService,
  ) {}

  async listPublic(query: PublicVendorListQueryDto) {
    const { items, total } =
      await this.vendorDashboardRepository.findPublicList(query);
    const vendorIds = items.map((vendor) => vendor.id);
    const [logos, productCounts] = await Promise.all([
      this.mediaService.getContextFilesForEntities(
        MediaEntityType.VENDOR_PROFILE,
        vendorIds,
        MediaContext.LOGO,
      ),
      this.vendorDashboardRepository.countActiveProductsByVendors(vendorIds),
    ]);
    const { take } = paginate(query.page, query.limit);

    return {
      message: 'Vendors fetched successfully',
      data: items.map((vendor) => ({
        id: vendor.id,
        businessName: vendor.businessName,
        slug: vendor.slug,
        bio: vendor.bio,
        city: vendor.city,
        state: vendor.state,
        logo: logos.get(vendor.id) ?? null,
        activeProductCount: productCounts.get(vendor.id) ?? 0,
      })),
      meta: paginationMeta(query.page, take, total),
    };
  }

  async getDashboard(vendorId: string) {
    const vendor =
      await this.vendorDashboardRepository.findApprovedVendor(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const last7 = new Date(now);
    last7.setDate(last7.getDate() - 7);
    const last30 = new Date(now);
    last30.setDate(last30.getDate() - 30);

    const [
      pendingOrdersCount,
      recentOrders,
      salesToday,
      sales7,
      sales30,
      lowStockCount,
      productCount,
      brandMedia,
    ] = await Promise.all([
      this.vendorDashboardRepository.countPendingOrders(vendorId),
      this.vendorDashboardRepository.findRecentOrders(vendorId),
      this.vendorDashboardRepository.salesInRange(vendorId, startOfToday, now),
      this.vendorDashboardRepository.salesInRange(vendorId, last7, now),
      this.vendorDashboardRepository.salesInRange(vendorId, last30, now),
      this.vendorDashboardRepository.countLowStockVariants(vendorId),
      this.vendorDashboardRepository.countAllProducts(vendorId),
      this.vendorStoreService.getStoreBrandMedia(vendorId),
    ]);

    const warnings: { code: string; message: string }[] = [];
    if (!brandMedia.logo) {
      warnings.push({
        code: 'MISSING_LOGO',
        message: 'Store logo is not set',
      });
    }
    if (!brandMedia.banner) {
      warnings.push({
        code: 'MISSING_BANNER',
        message: 'Store banner is not set',
      });
    }
    if (!vendor.shippingMethod?.isActive) {
      warnings.push({
        code: 'SHIPPING_INCOMPLETE',
        message: 'Active shipping method is required',
      });
    }
    if (
      vendor.membership &&
      vendor.membership.productLimit != null &&
      vendor.membership.productLimit > 0 &&
      productCount >= vendor.membership.productLimit
    ) {
      warnings.push({
        code: 'PRODUCT_LIMIT',
        message: 'Product limit reached for current membership',
      });
    }
    if (
      vendor.membership &&
      vendor.membership.storageUsedMb >= vendor.membership.storageLimitMb * 0.9
    ) {
      warnings.push({
        code: 'STORAGE_NEAR_LIMIT',
        message: 'Media storage is near the membership limit',
      });
    }
    if (
      !vendor.storeSettings?.supportPhone &&
      !vendor.storeSettings?.supportEmail
    ) {
      warnings.push({
        code: 'SUPPORT_CONTACT_MISSING',
        message: 'Add a support phone or email in store settings',
      });
    }

    return {
      message: 'Vendor dashboard fetched successfully',
      data: {
        pendingOrdersCount,
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          subOrderNumber: order.subOrderNumber,
          orderNumber: order.order.orderNumber,
          status: order.status,
          total: formatMoney(order.total),
          paymentStatus: order.order.paymentStatus,
          paymentMethod: order.order.paymentMethod,
          createdAt: order.createdAt,
        })),
        wallet: vendor.wallet
          ? {
              balance: formatMoney(vendor.wallet.balance),
              lockedBalance: formatMoney(vendor.wallet.lockedBalance),
              totalEarned: formatMoney(vendor.wallet.totalEarned),
              totalWithdrawn: formatMoney(vendor.wallet.totalWithdrawn),
            }
          : null,
        salesSnapshot: {
          today: {
            total: formatMoney(salesToday.total),
            orderCount: salesToday.count,
          },
          last7Days: {
            total: formatMoney(sales7.total),
            orderCount: sales7.count,
          },
          last30Days: {
            total: formatMoney(sales30.total),
            orderCount: sales30.count,
          },
        },
        lowStockCount,
        warnings,
      },
    };
  }

  async getAnalytics(vendorId: string, query: VendorAnalyticsQueryDto) {
    const vendor =
      await this.vendorDashboardRepository.findApprovedVendor(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const { from, to } = this.resolveDateRange(query.from, query.to);

    const [
      sales,
      topProducts,
      cancellationsCount,
      refundsCount,
      payoutSummary,
    ] = await Promise.all([
      this.vendorDashboardRepository.salesInRange(vendorId, from, to),
      this.vendorDashboardRepository.topProducts(vendorId, from, to),
      this.vendorDashboardRepository.countCancellations(vendorId, from, to),
      this.vendorDashboardRepository.countRefunds(vendorId, from, to),
      this.vendorDashboardRepository.payoutSummary(vendorId, from, to),
    ]);

    const avgOrderValue =
      sales.count > 0 ? sales.total.div(sales.count) : new Prisma.Decimal(0);

    return {
      message: 'Vendor analytics fetched successfully',
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        salesTotal: formatMoney(sales.total),
        orderCount: sales.count,
        avgOrderValue: formatMoney(avgOrderValue),
        topProducts: topProducts.map((product) => ({
          variantId: product.variantId,
          productName: product.productName,
          sku: product.sku,
          quantity: product.quantity,
          revenue: formatMoney(product.revenue),
        })),
        cancellationsCount,
        refundsCount,
        payoutSummary: {
          count: payoutSummary.count,
          requested: formatMoney(payoutSummary.requested),
          completed: formatMoney(payoutSummary.completed),
          failed: formatMoney(payoutSummary.failed),
        },
      },
    };
  }

  async getPublicBySlug(slug: string, query: VendorStorefrontQueryDto) {
    const vendor = await this.vendorDashboardRepository.findPublicBySlug(slug);
    if (!vendor || !vendor.slug) {
      throw new NotFoundException('Vendor not found');
    }

    const [brandMedia, activeProductCount, products] = await Promise.all([
      this.vendorStoreService.getStoreBrandMedia(vendor.id),
      this.vendorDashboardRepository.countActiveProducts(vendor.id),
      this.productsService.browseVendorProducts(
        vendor.id,
        query.page,
        query.limit,
      ),
    ]);

    return {
      message: 'Vendor storefront fetched successfully',
      data: {
        id: vendor.id,
        businessName: vendor.businessName,
        slug: vendor.slug,
        bio: vendor.bio,
        city: vendor.city,
        state: vendor.state,
        pincode: vendor.pincode,
        storeSettings: vendor.storeSettings,
        logo: brandMedia.logo
          ? { url: brandMedia.logo.url, storageKey: brandMedia.logo.storageKey }
          : null,
        banner: brandMedia.banner
          ? {
              url: brandMedia.banner.url,
              storageKey: brandMedia.banner.storageKey,
            }
          : null,
        stats: {
          activeProductCount,
          memberSince: vendor.approvedAt ?? vendor.createdAt,
        },
        products: products.items,
      },
      meta: products.meta,
    };
  }

  private resolveDateRange(fromInput?: string, toInput?: string) {
    const to = toInput ? new Date(toInput) : new Date();
    const from = fromInput
      ? new Date(fromInput)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }

    if (from > to) {
      throw new BadRequestException('"from" must be before "to"');
    }

    const maxMs = 366 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxMs) {
      throw new BadRequestException('Date range cannot exceed 366 days');
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    return { from, to };
  }
}
