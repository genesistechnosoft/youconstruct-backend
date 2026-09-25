import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ProductsModule } from '../products/products.module';
import { VendorStoreModule } from '../vendor-store/vendor-store.module';
import {
  PublicVendorsController,
  VendorDashboardController,
} from './vendor-dashboard.controller';
import { VendorDashboardRepository } from './vendor-dashboard.repository';
import { VendorDashboardService } from './vendor-dashboard.service';

@Module({
  imports: [ProductsModule, VendorStoreModule, MediaModule],
  controllers: [VendorDashboardController, PublicVendorsController],
  providers: [VendorDashboardService, VendorDashboardRepository],
  exports: [VendorDashboardService],
})
export class VendorDashboardModule {}
