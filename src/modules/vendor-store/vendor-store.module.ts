import { Module } from '@nestjs/common';
import {
  AdminVendorMembershipController,
  VendorMembershipController,
} from './membership.controller';
import { VendorProductShippingController } from './product-shipping.controller';
import { VendorShippingController } from './shipping.controller';
import { VendorStoreSettingsController } from './store-settings.controller';
import { VendorStoreRepository } from './vendor-store.repository';
import { VendorStoreService } from './vendor-store.service';

@Module({
  controllers: [
    VendorStoreSettingsController,
    VendorMembershipController,
    AdminVendorMembershipController,
    VendorShippingController,
    VendorProductShippingController,
  ],
  providers: [VendorStoreService, VendorStoreRepository],
  exports: [VendorStoreService],
})
export class VendorStoreModule {}
