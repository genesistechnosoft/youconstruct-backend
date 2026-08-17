import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PAYMENT_TIMEOUT_QUEUE } from '../../queue/queue.constants';
import { StorageModule } from '../../storage/storage.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import {
  AdminOrdersController,
  AdminSubOrdersController,
} from './admin-orders.controller';
import { CancelRefundService } from './cancel-refund.service';
import { CustomerCheckoutController } from './customer-checkout.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { ShippingQuoteService } from './shipping-quote.service';
import { VendorOrdersController } from './vendor-orders.controller';

@Module({
  imports: [
    forwardRef(() => PaymentsModule),
    PlatformSettingsModule,
    StorageModule,
    CouponsModule,
    BullModule.registerQueue({ name: PAYMENT_TIMEOUT_QUEUE }),
  ],
  controllers: [
    CustomerCheckoutController,
    CustomerOrdersController,
    VendorOrdersController,
    AdminOrdersController,
    AdminSubOrdersController,
  ],
  providers: [
    OrdersService,
    OrdersRepository,
    ShippingQuoteService,
    CancelRefundService,
  ],
  exports: [OrdersService, OrdersRepository, ShippingQuoteService],
})
export class OrdersModule {}
