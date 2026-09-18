import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { CreateReturnRequestDto } from './dto/return-request.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Customer - Returns')
@ApiBearerAuth()
@Roles(PlatformRole.CUSTOMER)
@Controller()
export class CustomerReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get('customer/returns')
  @HttpCode(200)
  @ApiOperation({ summary: 'List my return requests' })
  list(@CurrentUser() user: { userId: string }) {
    return this.returnsService.listCustomer(user.userId);
  }

  @Get('customer/returns/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a return request' })
  getOne(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.getOne(id, { userId: user.userId });
  }

  @Post('customer/orders/:orderId/returns')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a return for delivered quantity' })
  create(
    @CurrentUser() user: { userId: string },
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReturnRequestDto,
  ) {
    return this.returnsService.createCustomer(user.userId, orderId, dto);
  }
}
