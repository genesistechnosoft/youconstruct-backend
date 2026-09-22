import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { AdminListBankAccountsQueryDto } from './dto/admin-list-bank-accounts-query.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Admin - Vendor Finance')
@Controller('admin/bank-accounts')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.VENDORS_WALLET)
@ApiBearerAuth()
export class AdminBankAccountsController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'List vendor bank accounts for verification',
    description:
      'Default inbox is unverified accounts. Pass isVerified=true for already verified.',
  })
  listBankAccounts(@Query() query: AdminListBankAccountsQueryDto) {
    return this.vendorFinanceService.listAdminBankAccounts(query);
  }
}
