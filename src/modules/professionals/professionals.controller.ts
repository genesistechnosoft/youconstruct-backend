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
import { OnboardingOnly } from '../../common/decorators/onboarding-only.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { RbacService } from '../rbac/rbac.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { CreateInvitationDto } from '../rbac/dto/create-invitation.dto';
import { CreateCustomRoleDto } from '../rbac/dto/create-custom-role.dto';
import { UpdateCustomRoleDto } from '../rbac/dto/update-custom-role.dto';
import {
  ListInvitationsDto,
  ListTeamMembersDto,
} from '../rbac/dto/list-team-query.dto';
import { UpdateTeamMemberDto } from '../rbac/dto/update-team-member.dto';
import { ProfessionalFiltersDto } from './dto/professional-filters.dto';
import { RejectProfessionalDto } from './dto/reject-professional.dto';
import { SuspendProfessionalDto } from './dto/suspend-professional.dto';
import { UpdateProfessionalProfileDto } from './dto/update-professional-profile.dto';
import { ProfessionalsService } from './professionals.service';

interface AuthUser {
  userId: string;
}

// ── Professional onboarding ──────────────────────────────────────────────────

@ApiTags('Professional - Onboarding')
@Controller('professional/onboarding')
@Roles(PlatformRole.PROFESSIONAL)
@OnboardingOnly()
@ApiBearerAuth()
export class ProfessionalOnboardingController {
  constructor(private readonly service: ProfessionalsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get my professional profile and onboarding status',
  })
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.service.getMyProfile(user.userId);
  }

  @Patch('profile')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update professional profile fields and category links',
  })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfessionalProfileDto,
  ) {
    return this.service.updateProfile(user.userId, dto);
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit professional profile for admin review' })
  submit(@CurrentUser() user: AuthUser) {
    return this.service.submitForReview(user.userId);
  }
}

// ── Professional team management ─────────────────────────────────────────────

@ApiTags('Professional - Team')
@Controller('professional/team')
@Roles(PlatformRole.PROFESSIONAL)
@RequireActiveContext(PermissionScope.PROFESSIONAL)
@Permissions(PERMISSIONS.PROFESSIONAL.TEAM_MANAGE)
@ApiBearerAuth()
export class ProfessionalTeamController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('members')
  @HttpCode(200)
  @ApiOperation({ summary: 'List professional team members' })
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTeamMembersDto,
  ) {
    return this.rbacService.listMembers(
      user,
      PermissionScope.PROFESSIONAL,
      query,
    );
  }

  @Patch('members/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update professional team member' })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.rbacService.updateMember(
      user,
      PermissionScope.PROFESSIONAL,
      id,
      dto,
    );
  }

  @Delete('members/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove professional team member' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.removeMember(
      user,
      PermissionScope.PROFESSIONAL,
      id,
    );
  }

  @Get('invitations')
  @HttpCode(200)
  @ApiOperation({ summary: 'List professional staff invitations' })
  listInvitations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvitationsDto,
  ) {
    return this.rbacService.listInvitations(
      user,
      PermissionScope.PROFESSIONAL,
      query,
    );
  }

  @Post('invitations')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Invite a user to the professional profile team',
    description:
      'Returns the raw invitation token because email delivery is not wired yet.',
  })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.rbacService.createInvitation(
      user,
      PermissionScope.PROFESSIONAL,
      dto,
    );
  }

  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a professional invitation' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.revokeInvitation(
      user,
      PermissionScope.PROFESSIONAL,
      id,
    );
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend a pending professional invitation' })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.resendInvitation(
      user,
      PermissionScope.PROFESSIONAL,
      id,
    );
  }
}

// ── Professional custom roles ─────────────────────────────────────────────────

@ApiTags('Professional - Roles')
@Controller('professional/roles')
@Roles(PlatformRole.PROFESSIONAL)
@RequireActiveContext(PermissionScope.PROFESSIONAL)
@Permissions(PERMISSIONS.PROFESSIONAL.ROLES_MANAGE)
@ApiBearerAuth()
export class ProfessionalRolesController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List custom roles for this professional profile' })
  listRoles(@CurrentUser() user: AuthenticatedUser) {
    return this.rbacService.listRoles(user, PermissionScope.PROFESSIONAL);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a custom role for this professional profile' })
  getRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.getRole(user, PermissionScope.PROFESSIONAL, id);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create a custom role for this professional profile',
  })
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomRoleDto,
  ) {
    return this.rbacService.createRole(user, PermissionScope.PROFESSIONAL, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update a custom role for this professional profile',
  })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.rbacService.updateRole(
      user,
      PermissionScope.PROFESSIONAL,
      id,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete a custom role for this professional profile',
  })
  deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rbacService.deleteRole(user, PermissionScope.PROFESSIONAL, id);
  }
}

// ── Admin — Professionals ─────────────────────────────────────────────────────

@ApiTags('Admin - Professionals')
@Controller('admin/professionals')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminProfessionalsController {
  constructor(private readonly service: ProfessionalsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_VIEW)
  @ApiOperation({ summary: 'List professional profiles with optional filters' })
  list(@Query() filters: ProfessionalFiltersDto) {
    return this.service.listForAdmin(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_VIEW)
  @ApiOperation({ summary: 'Get full professional profile for admin review' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getForAdmin(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_APPROVE)
  @ApiOperation({ summary: 'Approve a professional profile' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approveProfile(id, user.userId);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_REJECT)
  @ApiOperation({ summary: 'Reject a submitted professional profile' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProfessionalDto,
  ) {
    return this.service.rejectProfile(id, user.userId, dto);
  }

  @Patch(':id/suspend')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_SUSPEND)
  @ApiOperation({ summary: 'Suspend an approved professional profile' })
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendProfessionalDto,
  ) {
    return this.service.suspendProfile(id, user.userId, dto);
  }

  @Patch(':id/reinstate')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONALS_SUSPEND)
  @ApiOperation({ summary: 'Reinstate a suspended professional profile' })
  reinstate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.reinstateProfile(id, user.userId);
  }
}
