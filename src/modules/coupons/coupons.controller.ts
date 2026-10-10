import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CouponFiltersDto,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';
import { CouponsService } from './coupons.service';

@ApiTags('Admin - Coupons')
@Controller('admin/coupons')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.COUPONS_MANAGE)
@ApiBearerAuth()
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List platform coupons' })
  list(@Query() filters: CouponFiltersDto) {
    return this.couponsService.listAdmin(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get platform coupon' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.getAdmin(id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create platform coupon' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto) {
    return this.couponsService.createPlatform(user.userId, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update platform coupon' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.updatePlatform(id, dto);
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate platform coupon' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.activatePlatform(id);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate platform coupon' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.deactivatePlatform(id);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete platform coupon' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.couponsService.removePlatform(id);
  }
}

@ApiTags('Vendor - Coupons')
@Controller('vendor/coupons')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'List my vendor coupons' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: CouponFiltersDto,
  ) {
    return this.couponsService.listVendor(requireVendorEntityId(user), filters);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Get my vendor coupon' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.couponsService.getVendor(requireVendorEntityId(user), id);
  }

  @Post()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Create vendor coupon' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto) {
    return this.couponsService.createVendor(
      requireVendorEntityId(user),
      user.userId,
      dto,
    );
  }

  @Patch(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Update vendor coupon' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.updateVendor(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Activate vendor coupon' })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.couponsService.activateVendor(requireVendorEntityId(user), id);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Deactivate vendor coupon' })
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.couponsService.deactivateVendor(
      requireVendorEntityId(user),
      id,
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.COUPONS_MANAGE)
  @ApiOperation({ summary: 'Soft-delete vendor coupon' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.couponsService.removeVendor(requireVendorEntityId(user), id);
  }
}
