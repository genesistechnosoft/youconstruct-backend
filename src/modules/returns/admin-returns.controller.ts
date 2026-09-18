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
import {
  PermissionScope,
  ReturnStatus,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import {
  AdminOverrideReturnDto,
  ConfirmOfflineRefundDto,
  ConfirmReturnReceiptDto,
} from './dto/return-request.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Admin - Returns')
@Controller('admin/returns')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_VIEW)
  @ApiOperation({ summary: 'List all return requests' })
  list() {
    return this.returnsService.listAdmin();
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_VIEW)
  @ApiOperation({ summary: 'Get a return request' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.returnsService.getOne(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Admin override: approve return' })
  approve(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOverrideReturnDto,
  ) {
    return this.returnsService.adminOverride(
      id,
      user.userId,
      dto,
      ReturnStatus.APPROVED,
    );
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Admin override: reject return' })
  reject(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOverrideReturnDto,
  ) {
    return this.returnsService.adminOverride(
      id,
      user.userId,
      dto,
      ReturnStatus.REJECTED,
    );
  }

  @Patch(':id/receipt')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({
    summary: 'Admin override: confirm return receipt without OTP',
  })
  confirmReceipt(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReturnReceiptDto,
  ) {
    return this.returnsService.confirmReceipt(id, user.userId, dto, {
      admin: true,
    });
  }

  @Post(':id/online-refund/retry')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Retry Razorpay refund for a return' })
  retry(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.retryOnlineRefund(id, user.userId);
  }

  @Patch(':id/offline-refund')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.ORDERS_MANAGE)
  @ApiOperation({
    summary: 'Admin override: confirm offline cash refund without OTP',
  })
  confirmOffline(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOfflineRefundDto,
  ) {
    return this.returnsService.confirmOfflineRefund(id, user.userId, dto, {
      admin: true,
    });
  }
}
