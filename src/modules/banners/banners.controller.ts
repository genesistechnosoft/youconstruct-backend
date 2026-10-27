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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
import { Public } from '../../common/decorators/public.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@ApiTags('Banners')
@Public()
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List active homepage banners in schedule window' })
  findPublic() {
    return this.bannersService.findPublic();
  }
}

@ApiTags('Admin - Banners')
@Controller('admin/banners')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
@ApiBearerAuth()
export class AdminBannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List homepage banners including inactive' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.bannersService.findAllAdmin(query.page, query.limit);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a homepage banner by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findById(id);
  }

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'webImage', maxCount: 1 },
        { name: 'appImage', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', example: 'Monsoon Sale' },
        subtitle: { type: 'string', example: 'Up to 40% off on tiles' },
        targetUrl: { type: 'string', example: 'https://youconstruct.com/sale' },
        sortOrder: {
          type: 'integer',
          example: 2,
          description:
            'Optional. Omitted assigns one past the highest sortOrder among banners that are not deleted.',
        },
        isActive: { type: 'boolean', example: true },
        startsAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-07-01T00:00:00.000Z',
        },
        endsAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-08-01T00:00:00.000Z',
        },
        webImage: { type: 'string', format: 'binary' },
        appImage: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Create a homepage banner. At least one of webImage or appImage must be provided.',
  })
  create(
    @Body() dto: CreateBannerDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files: {
      webImage?: Express.Multer.File[];
      appImage?: Express.Multer.File[];
    },
  ) {
    return this.bannersService.create(
      dto,
      user.userId,
      files?.webImage?.[0],
      files?.appImage?.[0],
    );
  }

  @Patch('reorder')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Reorder homepage banners. orderedIds must include every non-deleted banner exactly once.',
  })
  reorder(@Body() dto: ReorderBannersDto) {
    return this.bannersService.reorder(dto);
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a homepage banner' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bannersService.activate(id, user.userId);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a homepage banner' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bannersService.deactivate(id, user.userId);
  }

  @Patch(':id')
  @HttpCode(200)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'webImage', maxCount: 1 },
        { name: 'appImage', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', example: 'Monsoon Sale' },
        subtitle: { type: 'string', example: 'Updated promo copy' },
        targetUrl: { type: 'string', example: 'https://youconstruct.com/sale' },
        sortOrder: { type: 'integer', example: 0 },
        isActive: { type: 'boolean', example: true },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        webImage: { type: 'string', format: 'binary' },
        appImage: { type: 'string', format: 'binary' },
        removeWebImage: { type: 'boolean', example: false },
        removeAppImage: { type: 'boolean', example: true },
      },
    },
  })
  @ApiOperation({
    summary:
      'Update a homepage banner. A file replaces that image. removeWebImage or removeAppImage true clears that image when no file is sent.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles()
    files: {
      webImage?: Express.Multer.File[];
      appImage?: Express.Multer.File[];
    },
  ) {
    return this.bannersService.update(
      id,
      dto,
      user.userId,
      files?.webImage?.[0],
      files?.appImage?.[0],
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a homepage banner' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }
}
