import { Module } from '@nestjs/common';
import { AdminPayoutsController } from './admin-payouts.controller';
import { AdminVendorFinanceController } from './admin-vendor-finance.controller';
import { VendorBankAccountController } from './bank-account.controller';
import { VendorPayoutsController } from './payouts.controller';
import { VendorFinanceRepository } from './vendor-finance.repository';
import { VendorFinanceService } from './vendor-finance.service';
import { VendorWalletController } from './wallet.controller';

@Module({
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
