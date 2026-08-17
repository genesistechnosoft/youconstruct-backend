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
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
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
  @ApiOperation({ summary: 'Create a homepage banner' })
  create(@Body() dto: CreateBannerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bannersService.create(dto, user.userId);
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
  @ApiOperation({ summary: 'Update a homepage banner' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bannersService.update(id, dto, user.userId);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a homepage banner' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }
}
