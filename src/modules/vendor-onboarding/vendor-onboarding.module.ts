import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  AdminVendorsController,
  VendorOnboardingController,
} from './vendor-onboarding.controller';
import { VendorOnboardingRepository } from './vendor-onboarding.repository';
import { VendorOnboardingService } from './vendor-onboarding.service';

@Module({
  imports: [MediaModule],
  controllers: [VendorOnboardingController, AdminVendorsController],
  providers: [VendorOnboardingService, VendorOnboardingRepository],
  exports: [VendorOnboardingService],
})
export class VendorOnboardingModule {}
