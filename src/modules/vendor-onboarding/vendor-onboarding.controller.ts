import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import {
  KycDocumentType,
  PermissionScope,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingOnly } from '../../common/decorators/onboarding-only.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { RejectKycDocumentDto } from './dto/reject-kyc-document.dto';
import { RejectVendorDto } from './dto/reject-vendor.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { UpsertKycDocumentDto } from './dto/upsert-kyc-document.dto';
import { VendorFiltersDto } from './dto/vendor-filters.dto';
import { VendorOnboardingService } from './vendor-onboarding.service';

interface AuthUser {
  userId: string;
}

@ApiTags('Vendor - Onboarding')
@Controller('vendor/onboarding')
@Roles(PlatformRole.VENDOR)
@OnboardingOnly()
@ApiBearerAuth()
export class VendorOnboardingController {
  constructor(
    private readonly vendorOnboardingService: VendorOnboardingService,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get my vendor onboarding status' })
  getMyOnboarding(@CurrentUser() user: AuthUser) {
    return this.vendorOnboardingService.getMyOnboarding(user.userId);
  }

  @Patch('profile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update my vendor store profile' })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateVendorProfileDto,
  ) {
    return this.vendorOnboardingService.updateProfile(user.userId, dto);
  }

  @Put('kyc/:documentType')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload or replace a KYC document URL' })
  upsertKycDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentType', new ParseEnumPipe(KycDocumentType))
    documentType: KycDocumentType,
    @Body() dto: UpsertKycDocumentDto,
  ) {
    return this.vendorOnboardingService.upsertKycDocument(
      user.userId,
      documentType,
      dto,
    );
  }

  @Put('kyc/:documentType/upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentNo: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload or replace a private KYC document file' })
  uploadKycDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentType', new ParseEnumPipe(KycDocumentType))
    documentType: KycDocumentType,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadKycDocumentDto,
  ) {
    return this.vendorOnboardingService.uploadKycDocument(
      user.userId,
      documentType,
      file,
      dto,
    );
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit vendor onboarding for admin review' })
  submitForReview(@CurrentUser() user: AuthUser) {
    return this.vendorOnboardingService.submitForReview(user.userId);
  }
}

@ApiTags('Admin - Vendors')
@Controller('admin/vendors')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminVendorsController {
  constructor(
    private readonly vendorOnboardingService: VendorOnboardingService,
  ) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_VIEW)
  @ApiOperation({ summary: 'List vendors for admin review' })
  getVendors(@Query() filters: VendorFiltersDto) {
    return this.vendorOnboardingService.getVendors(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_VIEW)
  @ApiOperation({ summary: 'Get vendor review detail' })
  getVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendorOnboardingService.getVendor(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_APPROVE)
  @ApiOperation({ summary: 'Approve a submitted vendor' })
  approveVendor(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vendorOnboardingService.approveVendor(id, user.userId);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_REJECT)
  @ApiOperation({ summary: 'Reject a submitted vendor' })
  rejectVendor(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVendorDto,
  ) {
    return this.vendorOnboardingService.rejectVendor(id, user.userId, dto);
  }

  @Patch(':id/kyc/:documentType/verify')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_APPROVE)
  @ApiOperation({ summary: 'Verify a vendor KYC document' })
  verifyKycDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentType', new ParseEnumPipe(KycDocumentType))
    documentType: KycDocumentType,
  ) {
    return this.vendorOnboardingService.verifyKycDocument(
      id,
      documentType,
      user.userId,
    );
  }

  @Patch(':id/kyc/:documentType/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.VENDORS_REJECT)
  @ApiOperation({ summary: 'Reject a vendor KYC document' })
  rejectKycDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentType', new ParseEnumPipe(KycDocumentType))
    documentType: KycDocumentType,
    @Body() dto: RejectKycDocumentDto,
  ) {
    return this.vendorOnboardingService.rejectKycDocument(
      id,
      documentType,
      user.userId,
      dto,
    );
  }
}
