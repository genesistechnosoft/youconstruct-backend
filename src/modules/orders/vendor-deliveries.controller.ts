import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

@ApiTags('Vendor - Deliveries')
@Controller('vendor/orders/:subOrderId/deliveries')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorDeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'List deliveries for a sub-order' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
  ) {
    return this.deliveriesService.listVendor(
      requireVendorEntityId(user),
      subOrderId,
    );
  }

  @Post()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Create a draft partial delivery' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: CreateDeliveryDto,
  ) {
    return this.deliveriesService.createVendor(
      requireVendorEntityId(user),
      subOrderId,
      user.userId,
      dto,
    );
  }

  @Patch(':id/status')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({
    summary: 'Update delivery status (OTP required at DELIVERED)',
  })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateVendorStatus(
      requireVendorEntityId(user),
      subOrderId,
      id,
      user.userId,
      dto,
    );
  }

  @Post(':id/otp')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Resend delivery confirmation OTP' })
  resendOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveriesService.resendVendorOtp(
      requireVendorEntityId(user),
      subOrderId,
      id,
    );
  }
}
