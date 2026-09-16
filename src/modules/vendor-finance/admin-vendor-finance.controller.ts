import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Admin - Vendor Finance')
@Controller('admin/vendors')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.VENDORS_WALLET)
@ApiBearerAuth()
export class AdminVendorFinanceController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get(':id/wallet')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get vendor wallet (admin)' })
  getWallet(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendorFinanceService.getAdminWallet(id);
  }

  @Get(':id/transactions')
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendor wallet transactions (admin)' })
  listTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WalletTransactionsQueryDto,
  ) {
    return this.vendorFinanceService.listAdminTransactions(id, query);
  }

  @Patch(':id/bank-account/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify vendor bank account' })
  verifyBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorFinanceService.verifyBankAccount(id, user.userId);
  }
}
