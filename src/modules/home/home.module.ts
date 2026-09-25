import { Module } from '@nestjs/common';
import { BannersModule } from '../banners/banners.module';
import { BrandsModule } from '../brands/brands.module';
import { CategoriesModule } from '../categories/categories.module';
import { CouponsModule } from '../coupons/coupons.module';
import { ProductsModule } from '../products/products.module';
import { VendorDashboardModule } from '../vendor-dashboard/vendor-dashboard.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [
    BannersModule,
    BrandsModule,
    CategoriesModule,
    CouponsModule,
    ProductsModule,
    VendorDashboardModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
