import { Controller, Get, HttpCode, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import {
  PublicVendorListQueryDto,
  VendorAnalyticsQueryDto,
  VendorStorefrontQueryDto,
} from './dto/vendor-dashboard.dto';
import { VendorDashboardService } from './vendor-dashboard.service';

@ApiTags('Vendor - Dashboard')
@Controller('vendor')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorDashboardController {
  constructor(
    private readonly vendorDashboardService: VendorDashboardService,
  ) {}

  @Get('dashboard')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'Vendor operations dashboard snapshot' })
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorDashboardService.getDashboard(
      requireVendorEntityId(user),
    );
  }

  @Get('analytics')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'Vendor analytics for a date range' })
  getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: VendorAnalyticsQueryDto,
  ) {
    return this.vendorDashboardService.getAnalytics(
      requireVendorEntityId(user),
      query,
    );
  }
}

@ApiTags('Vendors')
@Public()
@Controller('vendors')
export class PublicVendorsController {
  constructor(
    private readonly vendorDashboardService: VendorDashboardService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'List approved vendor storefronts' })
  list(@Query() query: PublicVendorListQueryDto) {
    return this.vendorDashboardService.listPublic(query);
  }

  @Get('by-slug/:slug')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Public vendor storefront by slug' })
  getBySlug(
    @Param('slug') slug: string,
    @Query() query: VendorStorefrontQueryDto,
  ) {
    return this.vendorDashboardService.getPublicBySlug(slug, query);
  }
}
