import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  AdminProductsController,
  ProductsController,
  VendorProductsController,
} from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [MediaModule],
  controllers: [
    ProductsController,
    VendorProductsController,
    AdminProductsController,
  ],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
