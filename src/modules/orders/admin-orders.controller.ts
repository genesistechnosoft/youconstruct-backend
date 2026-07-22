import {
  Body,
  Controller,
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
import { PERMISSIONS } from '../rbac/permissions.constants';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { AdminUpdateOrderStatusDto } from './dto/admin-update-order-status.dto';
import {
  ListOrdersQueryDto,
  ListSubOrdersQueryDto,
} from './dto/list-orders-query.dto';
import { UpdateSubOrderStatusDto } from './dto/update-sub-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('Admin - Orders')
@Controller('admin/orders')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_VIEW)
  @ApiOperation({ summary: 'List all orders' })
  list(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.listAdminOrders(query);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_VIEW)
  @ApiOperation({ summary: 'Get order by id' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getAdminOrder(id);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Admin override order status' })
  updateStatus(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateOrderStatusDto,
  ) {
    return this.ordersService.adminUpdateOrderStatus(id, user.userId, dto);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Stub refund — no payment reversal' })
  refund(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminRefundDto,
  ) {
    return this.ordersService.adminRefund(id, user.userId, dto);
  }
}

@ApiTags('Admin - Sub-Orders')
@Controller('admin/sub-orders')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminSubOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_VIEW)
  @ApiOperation({ summary: 'List all sub-orders' })
  list(@Query() query: ListSubOrdersQueryDto) {
    return this.ordersService.listAdminSubOrders(query);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Update sub-order status' })
  updateStatus(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubOrderStatusDto,
  ) {
    return this.ordersService.adminUpdateSubOrderStatus(
      id,
      user.userId,
      dto,
    );
  }
}
