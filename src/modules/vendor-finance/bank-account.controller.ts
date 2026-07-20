import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { VendorFinanceService } from './vendor-finance.service';

@ApiTags('Vendor - Bank Account')
@Controller('vendor/bank-account')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorBankAccountController {
  constructor(private readonly vendorFinanceService: VendorFinanceService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.BANK_MANAGE)
  @ApiOperation({ summary: 'Get vendor bank account' })
  getBankAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorFinanceService.getBankAccount(
      requireVendorEntityId(user),
    );
  }

  @Post()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.BANK_MANAGE)
  @ApiOperation({ summary: 'Create vendor bank account' })
  createBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.vendorFinanceService.createBankAccount(
      requireVendorEntityId(user),
      dto,
    );
  }

  @Patch()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.BANK_MANAGE)
  @ApiOperation({ summary: 'Update vendor bank account' })
  updateBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.vendorFinanceService.updateBankAccount(
      requireVendorEntityId(user),
      dto,
    );
  }

  @Delete()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.BANK_MANAGE)
  @ApiOperation({ summary: 'Delete vendor bank account' })
  deleteBankAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorFinanceService.deleteBankAccount(
      requireVendorEntityId(user),
    );
  }
}
