import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminPayoutsController } from './admin-payouts.controller';
import { AdminVendorFinanceController } from './admin-vendor-finance.controller';
import { VendorBankAccountController } from './bank-account.controller';
import { VendorPayoutsController } from './payouts.controller';
import { VendorFinanceRepository } from './vendor-finance.repository';
import { VendorFinanceService } from './vendor-finance.service';
import { VendorWalletController } from './wallet.controller';

@Module({
  imports: [AuthModule, PlatformSettingsModule],
  controllers: [
    VendorWalletController,
    VendorBankAccountController,
    VendorPayoutsController,
    AdminVendorFinanceController,
    AdminPayoutsController,
  ],
  providers: [VendorFinanceService, VendorFinanceRepository],
  exports: [VendorFinanceService],
})
export class VendorFinanceModule {}
