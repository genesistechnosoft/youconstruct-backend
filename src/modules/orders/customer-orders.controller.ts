import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
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
}
