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
import {
  ConfirmOfflineRefundDto,
  ConfirmReturnReceiptDto,
  ReviewReturnDto,
} from './dto/return-request.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Vendor - Returns')
@Controller('vendor/returns')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'List vendor return requests' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.returnsService.listVendor(requireVendorEntityId(user));
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_VIEW)
  @ApiOperation({ summary: 'Get a vendor return request' })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.getOne(id, {
      vendorId: requireVendorEntityId(user),
    });
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Approve a return request' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReturnDto,
  ) {
    return this.returnsService.approveVendor(
      requireVendorEntityId(user),
      id,
      user.userId,
      dto,
    );
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Reject a return request' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReturnDto,
  ) {
    return this.returnsService.rejectVendor(
      requireVendorEntityId(user),
      id,
      user.userId,
      dto,
    );
  }

  @Post(':id/receipt-otp')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Send return receipt OTP' })
  sendReceiptOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.sendReceiptOtp(requireVendorEntityId(user), id);
  }

  @Post(':id/receipt')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Confirm return receipt with OTP and restock' })
  confirmReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmReturnReceiptDto,
  ) {
    return this.returnsService.confirmReceipt(id, user.userId, dto, {
      vendorId: requireVendorEntityId(user),
    });
  }

  @Post(':id/online-refund/retry')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Retry Razorpay refund for a received return' })
  retryRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.retryOnlineRefund(id, user.userId);
  }

  @Post(':id/offline-refund-otp')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Send offline cash refund OTP' })
  sendOfflineOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returnsService.sendOfflineRefundOtp(
      requireVendorEntityId(user),
      id,
    );
  }

  @Post(':id/offline-refund')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.ORDERS_MANAGE)
  @ApiOperation({ summary: 'Confirm offline cash refund with OTP' })
  confirmOffline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOfflineRefundDto,
  ) {
    return this.returnsService.confirmOfflineRefund(id, user.userId, dto, {
      vendorId: requireVendorEntityId(user),
    });
  }
}
