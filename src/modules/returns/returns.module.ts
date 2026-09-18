import { Module, forwardRef } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminReturnsController } from './admin-returns.controller';
import { CustomerReturnsController } from './customer-returns.controller';
import { ReturnsRepository } from './returns.repository';
import { ReturnsService } from './returns.service';
import { VendorReturnsController } from './vendor-returns.controller';

@Module({
  imports: [PlatformSettingsModule, forwardRef(() => PaymentsModule)],
  controllers: [
    CustomerReturnsController,
    VendorReturnsController,
    AdminReturnsController,
  ],
  providers: [ReturnsService, ReturnsRepository],
  exports: [ReturnsService],
})
export class ReturnsModule {}
