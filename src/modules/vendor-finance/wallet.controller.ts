import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Vendor - Wallet')
@Controller('vendor/wallet')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorWalletController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.WALLET_VIEW)
  @ApiOperation({ summary: 'Get vendor wallet balance and totals' })
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorFinanceService.getWallet(requireVendorEntityId(user));
  }

  @Get('transactions')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.WALLET_VIEW)
  @ApiOperation({ summary: 'List vendor wallet transactions' })
  listTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WalletTransactionsQueryDto,
  ) {
    return this.vendorFinanceService.listTransactions(
      requireVendorEntityId(user),
      query,
    );
  }
}
