import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
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
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/decorators/roles.decorator';
import { CreateMediaLinkDto } from './dto/create-media-link.dto';
import { MediaContentQueryDto } from './dto/media-content-query.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MEDIA_VARIANTS } from './media.constants';
import { MediaService } from './media.service';
import { UploadedMediaFile } from './types/uploaded-media-file.type';

interface AuthUser {
  userId: string;
  role: UserRole;
}

@ApiTags('Media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload media' })
  @ApiBody({ type: UploadMediaDto })
  uploadMedia(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    return this.mediaService.uploadMedia(user, file, dto);
  }

  @Get('entity/:entityType/:entityId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get media linked to an entity' })
  getEntityMedia(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    return this.mediaService.getEntityMedia(user, entityType, entityId);
  }

  @Get(':id/content')
  @HttpCode(200)
  @ApiOperation({ summary: 'Serve media content' })
  async getContent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MediaContentQueryDto,
    @Res() response: Response,
  ) {
    const content = await this.mediaService.getContent(
      user,
      id,
      query.variant ?? MEDIA_VARIANTS.ORIGINAL,
    );

    if (content.mode === 'redirect' && content.url) {
      response.redirect(content.url);
      return;
    }

    response.setHeader('Content-Type', content.mimeType);
    response.setHeader('Content-Length', content.sizeBytes.toString());
    content.stream?.pipe(response);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get media details' })
  getMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mediaService.getMedia(user, id);
  }

  @Post(':id/links')
  @HttpCode(200)
  @ApiOperation({ summary: 'Link media to an entity' })
  createLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMediaLinkDto,
  ) {
    return this.mediaService.createLink(user, id, dto);
  }

  @Delete(':id/links/:linkId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unlink media from an entity' })
  deleteLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.mediaService.deleteLink(user, id, linkId);
  }
}
