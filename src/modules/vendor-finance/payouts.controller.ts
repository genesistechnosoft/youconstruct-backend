import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Vendor - Payouts')
@Controller('vendor/payouts')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@Permissions(PERMISSIONS.VENDOR.PAYOUTS_REQUEST)
@ApiBearerAuth()
export class VendorPayoutsController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendor payouts' })
  listPayouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPayoutsQueryDto,
  ) {
    return this.vendorFinanceService.listVendorPayouts(
      requireVendorEntityId(user),
      query,
    );
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a payout' })
  requestPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.vendorFinanceService.requestPayout(
      user.userId,
      requireVendorEntityId(user),
      dto,
    );
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get payout detail' })
  getPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorFinanceService.getVendorPayout(
      requireVendorEntityId(user),
      id,
    );
  }
}
