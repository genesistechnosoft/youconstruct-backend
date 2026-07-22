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
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { ListSubOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { UpdateSubOrderStatusDto } from './dto/update-sub-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('Vendor - Orders')
@Controller('vendor/orders')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'List vendor sub-orders' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSubOrdersQueryDto,
  ) {
    return this.ordersService.listVendorSubOrders(
      requireVendorEntityId(user),
      query,
    );
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'Get vendor sub-order' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getVendorSubOrder(
      requireVendorEntityId(user),
      id,
    );
  }

  @Patch(':id/status')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Update vendor sub-order status' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubOrderStatusDto,
  ) {
    return this.ordersService.updateVendorSubOrderStatus(
      requireVendorEntityId(user),
      id,
      user.userId,
      dto,
    );
  }

  @Patch(':id/shipment')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Update shipment for sub-order' })
  updateShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShipmentDto,
  ) {
    return this.ordersService.updateVendorShipment(
      requireVendorEntityId(user),
      id,
      user.userId,
      dto,
    );
  }
}
