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
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@ApiTags('Brands')
@Public()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all active brands' })
  findAll() {
    return this.brandsService.findAll();
  }

  @Get('by-slug/:slug')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get an active brand by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.brandsService.findBySlug(slug);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get an active brand by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.findById(id);
  }
}

@ApiTags('Admin - Brands')
@Controller('admin/brands')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
@ApiBearerAuth()
export class AdminBrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all brands including inactive' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.brandsService.findAllAdmin(query.page, query.limit);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a brand by ID including inactive' })
  findByIdAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.findByIdAdmin(id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a brand' })
  create(@Body() dto: CreateBrandDto) {
    return this.brandsService.create(dto);
  }

  @Post(':id/logo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload or replace a brand logo' })
  uploadLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.brandsService.uploadLogo(id, user.userId, file);
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a brand' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.activate(id);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a brand' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.deactivate(id);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a brand' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.brandsService.update(id, dto);
  }

  @Delete(':id/logo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a brand logo' })
  removeLogo(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.removeLogo(id);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a brand' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.remove(id);
  }
}
