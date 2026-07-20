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
import {
  PermissionScope,
  PlatformRole,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from './permissions.constants';
import {
  AcceptExistingInvitationDto,
  AcceptInvitationDto,
} from './dto/accept-invitation.dto';
import { AssignStaffDto } from './dto/assign-staff.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { RbacService } from './rbac.service';

@ApiTags('Vendor - Team')
@ApiBearerAuth()
@Controller('vendor/team')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@Permissions(PERMISSIONS.VENDOR.TEAM_MANAGE)
export class VendorTeamController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('members')
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendor team members' })
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listMembers(user, PermissionScope.VENDOR);
  }

  @Patch('members/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update vendor team member' })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.rbacService.updateMember(user, PermissionScope.VENDOR, id, dto);
  }

  @Delete('members/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove vendor team member' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.removeMember(user, PermissionScope.VENDOR, id);
  }

  @Get('invitations')
  @HttpCode(200)
  @ApiOperation({ summary: 'List vendor invitations' })
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listInvitations(user, PermissionScope.VENDOR);
  }

  @Post('invitations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Invite user to vendor store' })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.rbacService.createInvitation(user, PermissionScope.VENDOR, dto);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke vendor invitation' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.revokeInvitation(user, PermissionScope.VENDOR, id);
  }
}

@ApiTags('Admin - Team')
@ApiBearerAuth()
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('members')
  @HttpCode(200)
  @Roles(PlatformRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List admin team members' })
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listMembers(user, PermissionScope.ADMIN);
  }

  @Patch('members/:id')
  @HttpCode(200)
  @Roles(PlatformRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update admin team member' })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.rbacService.updateMember(user, PermissionScope.ADMIN, id, dto);
  }

  @Delete('members/:id')
  @HttpCode(200)
  @Roles(PlatformRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove admin team member' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.removeMember(user, PermissionScope.ADMIN, id);
  }

  @Post('staff')
  @HttpCode(200)
  @Roles(PlatformRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Invite ADMIN/SUPPORT staff to a custom role' })
  assignStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignStaffDto,
  ) {
    return this.rbacService.assignStaff(user, dto);
  }
}

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly rbacService: RbacService) {}

  @Public()
  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a team invitation' })
  accept(@Body() dto: AcceptInvitationDto) {
    return this.rbacService.acceptInvitation(dto);
  }

  @Post('accept-existing')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept a team invitation as the logged-in invited user',
  })
  acceptExisting(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptExistingInvitationDto,
  ) {
    return this.rbacService.acceptInvitation(
      { token: dto.token, existingAccount: true },
      user,
    );
  }
}
