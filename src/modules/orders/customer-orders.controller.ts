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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { CancelSubOrderDto } from './dto/cancel-sub-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrdersService } from './orders.service';

@ApiTags('Customer - Orders')
@ApiBearerAuth()
@Roles(PlatformRole.CUSTOMER)
@Controller('customer/orders')
export class CustomerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List my orders' })
  list(
    @CurrentUser() user: { userId: string },
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.listCustomerOrders(user.userId, query);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get my order by id' })
  getOne(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getCustomerOrder(user.userId, id);
  }

  @Post(':orderId/sub-orders/:subOrderId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a sub-order before shipping cutoff' })
  cancelSubOrder(
    @CurrentUser() user: { userId: string },
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: CancelSubOrderDto,
  ) {
    return this.ordersService.cancelCustomerSubOrder(
      user.userId,
      orderId,
      subOrderId,
      dto.reason,
    );
  }
}
