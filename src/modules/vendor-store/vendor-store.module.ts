import { Module, forwardRef } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  AdminVendorMembershipController,
  VendorMembershipController,
} from './membership.controller';
import { VendorProductShippingController } from './product-shipping.controller';
import { VendorShippingController } from './shipping.controller';
import { VendorStoreBrandingController } from './store-branding.controller';
import { VendorStoreSettingsController } from './store-settings.controller';
import { VendorStoreRepository } from './vendor-store.repository';
import { VendorStoreService } from './vendor-store.service';

@Module({
  imports: [forwardRef(() => MediaModule)],
  controllers: [
    VendorStoreSettingsController,
    VendorStoreBrandingController,
    VendorMembershipController,
    AdminVendorMembershipController,
    VendorShippingController,
    VendorProductShippingController,
  ],
  providers: [VendorStoreService, VendorStoreRepository],
  exports: [VendorStoreService],
})
export class VendorStoreModule {}
