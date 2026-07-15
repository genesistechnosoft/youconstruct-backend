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
  UseGuards,
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
import { KycDocumentType } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR)
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminVendorsController {
  constructor(
    private readonly vendorOnboardingService: VendorOnboardingService,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendors for admin review' })
  getVendors(@Query() filters: VendorFiltersDto) {
    return this.vendorOnboardingService.getVendors(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get vendor review detail' })
  getVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendorOnboardingService.getVendor(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a submitted vendor' })
  approveVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendorOnboardingService.approveVendor(id);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a submitted vendor' })
  rejectVendor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVendorDto,
  ) {
    return this.vendorOnboardingService.rejectVendor(id, dto);
  }
}
