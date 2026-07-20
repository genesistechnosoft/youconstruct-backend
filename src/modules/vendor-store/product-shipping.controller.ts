import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { UpsertProductShippingDto } from './dto/upsert-product-shipping.dto';
import { VendorStoreService } from './vendor-store.service';

@ApiTags('Vendor - Product Shipping')
@Controller('vendor/products')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorProductShippingController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Get(':id/shipping')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Get product shipping override' })
  getShipping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorStoreService.getProductShipping(
      requireVendorEntityId(user),
      id,
    );
  }

  @Put(':id/shipping')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Set product shipping override' })
  upsertShipping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertProductShippingDto,
  ) {
    return this.vendorStoreService.upsertProductShipping(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Delete(':id/shipping')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.SHIPPING_MANAGE)
  @ApiOperation({ summary: 'Remove product shipping override' })
  deleteShipping(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorStoreService.deleteProductShipping(
      requireVendorEntityId(user),
      id,
    );
  }
}
