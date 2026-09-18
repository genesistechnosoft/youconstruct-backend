import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { DeliveriesService } from './deliveries.service';
import { AdminUpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@ApiTags('Admin - Deliveries')
@Controller('admin/deliveries')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminDeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Patch(':id/status')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({
    summary:
      'Admin override delivery status (skips OTP, audited reason required)',
  })
  updateStatus(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateAdminStatus(id, user.userId, dto);
  }
}
