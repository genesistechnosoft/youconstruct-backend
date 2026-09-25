import { Injectable } from '@nestjs/common';
import { BannersService } from '../banners/banners.service';
import { BrandsService } from '../brands/brands.service';
import { CategoriesService } from '../categories/categories.service';
import { CouponsService } from '../coupons/coupons.service';
import {
  BrowseSortBy,
  BrowseSortOrder,
} from '../products/dto/browse-products.dto';
import { ProductsService } from '../products/products.service';
import { VendorDashboardService } from '../vendor-dashboard/vendor-dashboard.service';

@Injectable()
export class HomeService {
  constructor(
    private readonly bannersService: BannersService,
    private readonly brandsService: BrandsService,
    private readonly categoriesService: CategoriesService,
    private readonly couponsService: CouponsService,
    private readonly productsService: ProductsService,
    private readonly vendorDashboardService: VendorDashboardService,
  ) {}

  async getHome() {
    const [banners, brands, categories, coupons, products, vendors] =
      await Promise.all([
        this.bannersService.findPublic(),
        this.brandsService.listHighlights(12),
        this.categoriesService.listPublicParents(),
        this.couponsService.listPublicPlatform(10),
        this.productsService.browseProducts({
          sortBy: BrowseSortBy.CREATED_AT,
          sortOrder: BrowseSortOrder.DESC,
          page: 1,
          limit: 10,
        }),
        this.vendorDashboardService.listPublic({ page: 1, limit: 10 }),
      ]);

    return {
      message: 'Homepage fetched successfully',
      data: {
        banners: banners.data,
        brands,
        categories,
        coupons,
        products: products.data,
        vendors: vendors.data,
      },
    };
  }
}
