import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateVendorMembershipDto } from './dto/update-vendor-membership.dto';
import { VendorStoreService } from './vendor-store.service';

@ApiTags('Vendor - Membership')
@Controller('vendor/membership')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorMembershipController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEMBERSHIP_VIEW)
  @ApiOperation({ summary: 'Get current vendor membership and usage' })
  getMembership(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorStoreService.getMembership(requireVendorEntityId(user));
  }
}

@ApiTags('Admin - Vendor Membership')
@Controller('admin/vendors')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminVendorMembershipController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Patch(':id/membership')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_MEMBERSHIP)
  @ApiOperation({ summary: 'Update vendor membership plan and limits' })
  updateMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorMembershipDto,
  ) {
    return this.vendorStoreService.updateMembership(id, dto);
  }
}
