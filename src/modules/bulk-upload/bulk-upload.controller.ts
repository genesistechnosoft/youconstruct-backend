import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { BulkUploadService } from './bulk-upload.service';
import { ListBulkUploadsQueryDto } from './dto/list-bulk-uploads-query.dto';

@ApiTags('Vendor - Bulk Upload')
@Controller('vendor/products/bulk')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorBulkUploadController {
  constructor(private readonly bulkUploadService: BulkUploadService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'List vendor bulk uploads' })
  listUploads(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBulkUploadsQueryDto,
  ) {
    return this.bulkUploadService.listUploads(user.userId, query);
  }

  @Post('upload')
  @HttpCode(201)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_CREATE)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a CSV file for bulk product creation' })
  uploadCsv(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.bulkUploadService.uploadCsv(user.userId, file, {});
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'Get bulk upload detail with invalid rows sample' })
  getUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bulkUploadService.getUpload(user.userId, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_CREATE)
  @ApiOperation({
    summary: 'Confirm a validated upload to start import processing',
  })
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bulkUploadService.confirmUpload(user.userId, id);
  }
}

@ApiTags('Admin - Bulk Upload')
@Controller('admin/products/bulk')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminBulkUploadController {
  constructor(private readonly bulkUploadService: BulkUploadService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Admin: list all bulk uploads' })
  listUploads(@Query() query: ListBulkUploadsQueryDto) {
    return this.bulkUploadService.adminListUploads(query);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Admin: get bulk upload detail' })
  getUpload(@Param('id', ParseUUIDPipe) id: string) {
    return this.bulkUploadService.adminGetUpload(id);
  }
}
