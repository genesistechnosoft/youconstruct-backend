import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import {
  AdminVendorsController,
  VendorOnboardingController,
} from './vendor-onboarding.controller';
import { VendorOnboardingRepository } from './vendor-onboarding.repository';
import { VendorOnboardingService } from './vendor-onboarding.service';

@Module({
  imports: [MediaModule, PlatformSettingsModule],
  controllers: [VendorOnboardingController, AdminVendorsController],
  providers: [VendorOnboardingService, VendorOnboardingRepository],
  exports: [VendorOnboardingService],
})
export class VendorOnboardingModule {}
