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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { AttributesService } from './attributes.service';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';

@ApiTags('Attributes')
@Public()
@Controller('attributes')
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all attribute definitions' })
  findAll() {
    return this.attributesService.findAll();
  }
}

@ApiTags('Admin - Attributes')
@Controller('admin/attributes')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
@ApiBearerAuth()
export class AdminAttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List attribute definitions (paginated)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.attributesService.findAllAdmin(query.page, query.limit);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get an attribute definition by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.attributesService.findById(id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create an attribute definition' })
  create(@Body() dto: CreateAttributeDto) {
    return this.attributesService.create(dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an attribute definition' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDto,
  ) {
    return this.attributesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hard-delete an unused attribute definition' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.attributesService.remove(id);
  }
}
