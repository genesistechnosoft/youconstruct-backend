import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { AuthService } from '../auth/auth.service';
import { PERMISSIONS } from './permissions.constants';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import {
  ListInvitationsDto,
  ListTeamMembersDto,
} from './dto/list-team-query.dto';
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
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTeamMembersDto,
  ) {
    return this.rbacService.listMembers(user, PermissionScope.VENDOR, query);
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
  listInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvitationsDto,
  ) {
    return this.rbacService.listInvitations(
      user,
      PermissionScope.VENDOR,
      query,
    );
  }

  @Post('invitations')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Invite user to vendor store',
    description:
      'Returns the raw invitation token because email delivery is not wired yet. Deviates from the usual no-raw-tokens rule and should be removed once invitations are emailed.',
  })
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

  @Post('invitations/:id/resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend a pending vendor invitation',
    description:
      'Rotates the token and extends expiry. The previous token stops working.',
  })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.resendInvitation(user, PermissionScope.VENDOR, id);
  }
}

@ApiTags('Admin - Team')
@ApiBearerAuth()
@Controller('admin/team')
@Roles(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.TEAM_MANAGE)
export class AdminTeamController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('members')
  @HttpCode(200)
  @ApiOperation({ summary: 'List admin team members' })
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTeamMembersDto,
  ) {
    return this.rbacService.listMembers(user, PermissionScope.ADMIN, query);
  }

  @Patch('members/:id')
  @HttpCode(200)
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
  @ApiOperation({ summary: 'Remove admin team member' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.removeMember(user, PermissionScope.ADMIN, id);
  }

  @Get('invitations')
  @HttpCode(200)
  @ApiOperation({ summary: 'List admin staff invitations' })
  listInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvitationsDto,
  ) {
    return this.rbacService.listInvitations(user, PermissionScope.ADMIN, query);
  }

  @Post('invitations')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Invite platform staff to a custom role',
    description:
      'Returns the raw invitation token because email delivery is not wired yet. Deviates from the usual no-raw-tokens rule and should be removed once invitations are emailed.',
  })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.rbacService.createInvitation(user, PermissionScope.ADMIN, dto);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke admin staff invitation' })
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.revokeInvitation(user, PermissionScope.ADMIN, id);
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend a pending admin staff invitation',
    description:
      'Rotates the token and extends expiry. The previous token stops working.',
  })
  resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.resendInvitation(user, PermissionScope.ADMIN, id);
  }
}

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Get('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview an invitation before accepting',
    description:
      'Returns email, scope, role name, expiry, and nextAction: ' +
      'CREATE_ACCOUNT (no account yet), LOGIN_REQUIRED (account exists — log in first), ' +
      'or ACCEPT (already logged in as the invited email). ' +
      'Send the current Bearer token to get ACCEPT instead of LOGIN_REQUIRED when applicable.',
  })
  async preview(
    @Query('token') token: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
    const callerUserId = bearerToken
      ? this.authService.decodeAccessTokenOptional(bearerToken)?.userId
      : undefined;
    return this.rbacService.previewInvitation(token, callerUserId);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept a team invitation',
    description:
      'Unified accept endpoint. ' +
      'New users: send name + password; an account is created and tokens are returned. ' +
      'Existing users: send a Bearer token for the invited email; tokens are re-issued with the ' +
      'new active context (and lane if it changed). ' +
      'If the email already has an account but no matching Bearer token is present the ' +
      'response is 409 with code LOGIN_REQUIRED — the client should redirect to login. ' +
      'Returns raw invitation token in response because email delivery is not wired yet.',
  })
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
    const callerUserId = bearerToken
      ? this.authService.decodeAccessTokenOptional(bearerToken)?.userId
      : undefined;

    const result = await this.rbacService.acceptInvitation(dto, callerUserId);

    if (result.issueTokens) {
      const tokens = await this.authService.issueTokensForUser(
        result.userId,
        result.platformRole,
      );
      return {
        message: result.message,
        data: { ...result.data, ...tokens.data },
      };
    }

    return { message: result.message, data: result.data };
  }
}
