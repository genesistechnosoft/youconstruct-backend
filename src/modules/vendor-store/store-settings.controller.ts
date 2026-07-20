import { Body, Controller, Get, HttpCode, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { VendorStoreService } from './vendor-store.service';

@ApiTags('Vendor - Store Settings')
@Controller('vendor/store/settings')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorStoreSettingsController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.STORE_SETTINGS)
  @ApiOperation({ summary: 'Get vendor store settings' })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorStoreService.getStoreSettings(
      requireVendorEntityId(user),
    );
  }

  @Patch()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.STORE_SETTINGS)
  @ApiOperation({ summary: 'Update vendor store settings' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStoreSettingsDto,
  ) {
    return this.vendorStoreService.updateStoreSettings(
      requireVendorEntityId(user),
      dto,
    );
  }
}
