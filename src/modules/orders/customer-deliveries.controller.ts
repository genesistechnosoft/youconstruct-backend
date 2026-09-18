import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { DeliveriesService } from './deliveries.service';
import { DeliveryRemarksDto } from './dto/update-delivery-status.dto';

@ApiTags('Customer - Deliveries')
@ApiBearerAuth()
@Roles(PlatformRole.CUSTOMER)
@Controller('customer/orders/:orderId/deliveries')
export class CustomerDeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Patch(':id/remarks')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add optional customer remarks on a delivery' })
  updateRemarks(
    @CurrentUser() user: { userId: string },
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveryRemarksDto,
  ) {
    return this.deliveriesService.updateCustomerRemarks(
      user.userId,
      orderId,
      id,
      dto,
    );
  }
}
