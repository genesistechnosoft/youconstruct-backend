import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { CouponsModule } from '../coupons/coupons.module';
import { MediaModule } from '../media/media.module';
import { OrdersModule } from '../orders/orders.module';
import { CartController } from './cart.controller';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';

@Module({
  imports: [OrdersModule, MediaModule, CouponsModule, CategoriesModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}
