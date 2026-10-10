import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { MediaModule } from '../media/media.module';
import { VendorStoreModule } from '../vendor-store/vendor-store.module';
import {
  AdminProductsController,
  ProductsController,
  VendorProductsController,
  VendorSkusController,
} from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [MediaModule, VendorStoreModule, CategoriesModule],
  controllers: [
    ProductsController,
    VendorProductsController,
    VendorSkusController,
    AdminProductsController,
  ],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
