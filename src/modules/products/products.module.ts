import { Module } from '@nestjs/common';
import {
  AdminProductsController,
  ProductsController,
  VendorProductsController,
} from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  controllers: [
    ProductsController,
    VendorProductsController,
    AdminProductsController,
  ],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
