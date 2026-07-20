import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  PermissionScope,
  PlatformRole,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { CreateMediaFolderDto } from './dto/create-media-folder.dto';
import { MediaFiltersDto } from './dto/media-filters.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UpdateMediaFolderDto } from './dto/update-media-folder.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService } from './media.service';

@ApiTags('Vendor - Media')
@Controller('vendor/media')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorMediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @ApiOperation({ summary: 'List my media library' })
  listMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: MediaFiltersDto,
  ) {
    return this.mediaService.listVendorMedia(
      requireVendorEntityId(user),
      filters,
    );
  }

  @Post()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @ApiOperation({ summary: 'Upload media to my library' })
  uploadMedia(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    return this.mediaService.uploadVendorMedia(
      user.userId,
      requireVendorEntityId(user),
      file,
      dto,
    );
  }

  @Patch(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @ApiOperation({ summary: 'Update media metadata' })
  updateMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.mediaService.updateVendorMedia(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_DELETE)
  @ApiOperation({ summary: 'Delete unused media' })
  deleteMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mediaService.deleteVendorMedia(requireVendorEntityId(user), id);
  }

  @Get('folders')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @ApiOperation({ summary: 'List my media folders' })
  listFolders(@CurrentUser() user: AuthenticatedUser) {
    return this.mediaService.listVendorFolders(requireVendorEntityId(user));
  }

  @Post('folders')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @ApiOperation({ summary: 'Create a media folder' })
  createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMediaFolderDto,
  ) {
    return this.mediaService.createVendorFolder(
      requireVendorEntityId(user),
      dto,
    );
  }

  @Patch('folders/:id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_UPLOAD)
  @ApiOperation({ summary: 'Update a media folder' })
  updateFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaFolderDto,
  ) {
    return this.mediaService.updateVendorFolder(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Delete('folders/:id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.MEDIA_DELETE)
  @ApiOperation({ summary: 'Delete an empty media folder' })
  deleteFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mediaService.deleteVendorFolder(
      requireVendorEntityId(user),
      id,
    );
  }
}
