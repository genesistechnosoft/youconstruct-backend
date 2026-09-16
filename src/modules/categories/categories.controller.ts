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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get active category tree' })
  getTree() {
    return this.categoriesService.getTree();
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get an active category by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findById(id);
  }
}

@ApiTags('Admin - Categories')
@Controller('admin/categories')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
@ApiBearerAuth()
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a paginated category tree including inactive',
  })
  findAll(@Query() query: PaginationQueryDto) {
    return this.categoriesService.findAllAdmin(query.page, query.limit);
  }

  @Get('tree')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get full category tree including inactive' })
  getTree() {
    return this.categoriesService.getTreeAdmin();
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a category by ID including inactive' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findByIdAdmin(id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a category' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Post(':id/image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload or replace a category image' })
  uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.categoriesService.uploadImage(id, user.userId, file);
  }

  @Patch('reorder')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reorder sibling categories under a parent, or roots',
  })
  reorder(@Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorder(dto);
  }

  @Patch(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a category' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.activate(id);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a category' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.deactivate(id);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id/image')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a category image' })
  removeImage(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.removeImage(id);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a category' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(id);
  }
}
