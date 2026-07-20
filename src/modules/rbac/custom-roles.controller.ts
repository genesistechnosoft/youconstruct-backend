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
import {
  PermissionScope,
  PlatformRole,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from './permissions.constants';
import { CreateCustomRoleDto } from './dto/create-custom-role.dto';
import { UpdateCustomRoleDto } from './dto/update-custom-role.dto';
import { RbacService } from './rbac.service';

@ApiTags('Vendor - Roles')
@ApiBearerAuth()
@Controller('vendor/roles')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@Permissions(PERMISSIONS.VENDOR.ROLES_MANAGE)
export class VendorRolesController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendor custom roles' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listRoles(user, PermissionScope.VENDOR);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get vendor custom role' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.getRole(user, PermissionScope.VENDOR, id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create vendor custom role' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomRoleDto,
  ) {
    return this.rbacService.createRole(user, PermissionScope.VENDOR, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update vendor custom role' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.rbacService.updateRole(user, PermissionScope.VENDOR, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete vendor custom role' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.deleteRole(user, PermissionScope.VENDOR, id);
  }
}

@ApiTags('Admin - Roles')
@ApiBearerAuth()
@Controller('admin/roles')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.ROLES_MANAGE)
export class AdminRolesController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List admin custom roles' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listRoles(user, PermissionScope.ADMIN);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get admin custom role' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.getRole(user, PermissionScope.ADMIN, id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create admin custom role' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomRoleDto,
  ) {
    return this.rbacService.createRole(user, PermissionScope.ADMIN, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update admin custom role' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.rbacService.updateRole(user, PermissionScope.ADMIN, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete admin custom role' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.deleteRole(user, PermissionScope.ADMIN, id);
  }
}

@ApiTags('RBAC - Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsCatalogController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @HttpCode(200)
  @Roles(
    PlatformRole.VENDOR,
    PlatformRole.PROFESSIONAL,
    PlatformRole.ADMIN,
    PlatformRole.SUPPORT,
    PlatformRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'List permission catalog for a scope (scoped to caller lane)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope: PermissionScope,
  ) {
    return this.rbacService.listPermissionsForCaller(user, scope);
  }
}
