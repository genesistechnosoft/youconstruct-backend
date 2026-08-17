import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import {
  AdminCouponsController,
  VendorCouponsController,
} from './coupons.controller';
import { CouponsRepository } from './coupons.repository';
import { CouponsService } from './coupons.service';

@Module({
  imports: [PlatformSettingsModule],
  controllers: [AdminCouponsController, VendorCouponsController],
  providers: [CouponsService, CouponsRepository],
  exports: [CouponsService],
})
export class CouponsModule {}
