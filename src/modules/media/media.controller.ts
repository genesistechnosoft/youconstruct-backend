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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateMediaFolderDto } from './dto/create-media-folder.dto';
import { MediaFiltersDto } from './dto/media-filters.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UpdateMediaFolderDto } from './dto/update-media-folder.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaService } from './media.service';

interface AuthUser {
  userId: string;
}

@ApiTags('Vendor - Media')
@Controller('vendor/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR)
@ApiBearerAuth()
export class VendorMediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List my media library' })
  listMedia(@CurrentUser() user: AuthUser, @Query() filters: MediaFiltersDto) {
    return this.mediaService.listVendorMedia(user.userId, filters);
  }

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMediaDto })
  @ApiOperation({ summary: 'Upload media to my library' })
  uploadMedia(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    return this.mediaService.uploadVendorMedia(user.userId, file, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update media metadata' })
  updateMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.mediaService.updateVendorMedia(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete unused media' })
  deleteMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mediaService.deleteVendorMedia(user.userId, id);
  }

  @Get('folders')
  @HttpCode(200)
  @ApiOperation({ summary: 'List my media folders' })
  listFolders(@CurrentUser() user: AuthUser) {
    return this.mediaService.listVendorFolders(user.userId);
  }

  @Post('folders')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a media folder' })
  createFolder(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMediaFolderDto,
  ) {
    return this.mediaService.createVendorFolder(user.userId, dto);
  }

  @Patch('folders/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a media folder' })
  updateFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaFolderDto,
  ) {
    return this.mediaService.updateVendorFolder(user.userId, id, dto);
  }

  @Delete('folders/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an empty media folder' })
  deleteFolder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mediaService.deleteVendorFolder(user.userId, id);
  }
}
