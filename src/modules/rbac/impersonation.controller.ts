import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ImpersonationService } from './impersonation.service';

@ApiTags('Admin - Impersonation')
@ApiBearerAuth()
@Controller('admin/impersonate')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
@Permissions(PERMISSIONS.ADMIN.USERS_IMPERSONATE)
export class ImpersonationController {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @Post(':userId')
  @HttpCode(200)
  @RequireActiveContext(PermissionScope.ADMIN)
  @ApiOperation({
    summary: 'Start a 15-minute impersonation session as another user',
  })
  impersonate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.impersonationService.impersonate(user, userId);
  }
}
