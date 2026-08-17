import {
  Body,
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
import { PERMISSIONS } from '../rbac/permissions.constants';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { AdminListPayoutsQueryDto } from './dto/admin-list-payouts-query.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import { FailPayoutDto } from './dto/fail-payout.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Admin - Payouts')
@Controller('admin/payouts')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.PAYOUTS_MANAGE)
@ApiBearerAuth()
export class AdminPayoutsController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all payouts' })
  listPayouts(@Query() query: AdminListPayoutsQueryDto) {
    return this.vendorFinanceService.listAdminPayouts(query);
  }

  @Patch(':id/process')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark payout as PROCESSING' })
  processPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorFinanceService.processPayout(id, user.userId);
  }

  @Patch(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark payout as COMPLETED' })
  completePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletePayoutDto,
  ) {
    return this.vendorFinanceService.completePayout(id, user.userId, dto);
  }

  @Patch(':id/fail')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark payout as FAILED' })
  failPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailPayoutDto,
  ) {
    return this.vendorFinanceService.failPayout(id, user.userId, dto);
  }
}
