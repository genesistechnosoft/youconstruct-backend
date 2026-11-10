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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { Public } from '../../common/decorators/public.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { CreateProfessionalCategoryDto } from './dto/create-professional-category.dto';
import { UpdateProfessionalCategoryDto } from './dto/update-professional-category.dto';
import { ProfessionalCategoriesService } from './professional-categories.service';

@ApiTags('Public - Professional Categories')
@Controller('professional-categories')
export class PublicProfessionalCategoriesController {
  constructor(private readonly service: ProfessionalCategoriesService) {}

  @Get()
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all active professional categories' })
  list() {
    return this.service.listPublic();
  }
}

@ApiTags('Admin - Professional Categories')
@Controller('admin/professional-categories')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminProfessionalCategoriesController {
  constructor(private readonly service: ProfessionalCategoriesService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CATEGORIES_MANAGE)
  @ApiOperation({
    summary: 'List all professional categories (including inactive)',
  })
  list() {
    return this.service.listForAdmin();
  }

  @Post()
  @HttpCode(201)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Create a new professional category' })
  create(@Body() dto: CreateProfessionalCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Update a professional category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessionalCategoryDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Soft-delete a professional category' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
