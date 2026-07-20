import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { CreateShippingTierDto } from './dto/create-shipping-tier.dto';
import { UpsertShippingMethodDto } from './dto/upsert-shipping-method.dto';
import { VendorStoreService } from './vendor-store.service';

@ApiTags('Vendor - Shipping')
@Controller('vendor/store/shipping')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorShippingController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Get store shipping method and tiers' })
  getShipping(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorStoreService.getStoreShipping(
      requireVendorEntityId(user),
    );
  }

  @Put()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Create or update store shipping method' })
  upsertShipping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertShippingMethodDto,
  ) {
    return this.vendorStoreService.upsertStoreShipping(
      requireVendorEntityId(user),
      dto,
    );
  }

  @Post('tiers')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Add an order-value shipping tier' })
  addTier(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShippingTierDto,
  ) {
    return this.vendorStoreService.addShippingTier(
      requireVendorEntityId(user),
      dto,
    );
  }

  @Delete('tiers/:id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Delete an order-value shipping tier' })
  deleteTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorStoreService.deleteShippingTier(
      requireVendorEntityId(user),
      id,
    );
  }
}
