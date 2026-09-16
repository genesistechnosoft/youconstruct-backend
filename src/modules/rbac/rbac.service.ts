import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import {
  InvitationStatus,
  PermissionScope,
  PlatformRole,
  RoleKind,
  TeamMemberStatus,
} from '../../../generated/prisma/client.js';
import type {
  ActiveContext,
  AuthSession,
  AuthenticatedUser,
} from '../../common/types/auth-user.type';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import {
  ListInvitationsDto,
  ListTeamMembersDto,
  TeamMemberSortBy,
} from './dto/list-team-query.dto';
import { OWNER_ROLE_NAME, PERMISSIONS } from './permissions.constants';
import { RbacRepository } from './rbac.repository';
import { SecurityAuditService } from './security-audit.service';

export type StaffPlatformRole =
  | typeof PlatformRole.ADMIN
  | typeof PlatformRole.VENDOR
  | typeof PlatformRole.PROFESSIONAL;

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly rbacRepository: RbacRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly config: ConfigService,
  ) {}

  async buildAuthSession(
    userId: string,
    opts?: { isImpersonating?: boolean },
  ): Promise<AuthSession> {
    const user = await this.rbacRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }

    const { context: activeContext, accessRevoked } =
      await this.resolveMembershipState(user.id, user.platformRole);

    const sessionContext = activeContext
      ? {
          type: activeContext.type,
          entityId: activeContext.entityId,
          customRoleId: activeContext.customRoleId,
          roleName: activeContext.roleName ?? '',
          isOwner: activeContext.isOwner ?? false,
          isSuspended: activeContext.isSuspended ?? false,
        }
      : null;

    const permissions = sessionContext?.isSuspended
      ? []
      : await this.resolveSessionPermissions(user.platformRole, sessionContext);

    // Ex-staff keep their platformRole, so history is what separates them from
    // an owner who has not onboarded yet.
    const needsOnboarding =
      (user.platformRole === PlatformRole.VENDOR ||
        user.platformRole === PlatformRole.PROFESSIONAL) &&
      sessionContext === null &&
      !accessRevoked;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        platformRole: user.platformRole,
      },
      activeContext: sessionContext,
      permissions,
      flags: {
        needsOnboarding,
        isImpersonating: opts?.isImpersonating ?? false,
        accessRevoked,
      },
    };
  }

  private async resolveSessionPermissions(
    platformRole: PlatformRole,
    activeContext: AuthSession['activeContext'],
  ): Promise<string[]> {
    if (platformRole === PlatformRole.CUSTOMER) {
      return [];
    }

    if (platformRole === PlatformRole.SUPER_ADMIN) {
      const rows = await this.rbacRepository.findPermissionsByScope(
        PermissionScope.ADMIN,
      );
      return rows.map((row) => row.key);
    }

    if (!activeContext) {
      return [];
    }

    if (activeContext.isOwner) {
      const rows = await this.rbacRepository.findPermissionsByScope(
        activeContext.type,
      );
      return rows.map((row) => row.key);
    }

    const granted = await this.rbacRepository.findPermissionKeysForRole(
      activeContext.customRoleId,
    );
    return granted.map((row) => row.permission.key);
  }

  async resolveDefaultContext(
    userId: string,
    platformRole: PlatformRole,
  ): Promise<ActiveContext | undefined> {
    return this.resolveRequestContext(userId, platformRole);
  }

  async resolveRequestContext(
    userId: string,
    platformRole: PlatformRole,
  ): Promise<ActiveContext | undefined> {
    const { context } = await this.resolveMembershipState(userId, platformRole);
    return context;
  }

  async resolveMembershipState(
    userId: string,
    platformRole: PlatformRole,
  ): Promise<{ context?: ActiveContext; accessRevoked: boolean }> {
    if (
      platformRole === PlatformRole.SUPER_ADMIN ||
      platformRole === PlatformRole.CUSTOMER
    ) {
      return { accessRevoked: false };
    }

    const memberships =
      await this.rbacRepository.findMembershipsForContext(userId);

    if (memberships.length > 1) {
      // team_members_user_one_active_unique should make this impossible.
      this.logger.error(
        `User ${userId} has ${memberships.length} live memberships; using the oldest`,
      );
    }

    const membership = memberships[0];
    if (!membership) {
      const history = await this.rbacRepository.countMembershipHistory(userId);
      return { accessRevoked: history > 0 };
    }

    return {
      context: {
        type: membership.scope,
        entityId: membership.scopeEntityId,
        customRoleId: membership.customRoleId,
        roleName: membership.customRole.name,
        isOwner: membership.customRole.kind === RoleKind.OWNER,
        isSuspended: membership.status === TeamMemberStatus.SUSPENDED,
      },
      accessRevoked: false,
    };
  }

  async validateActiveContext(
    userId: string,
    context: ActiveContext,
  ): Promise<boolean> {
    const membership = await this.rbacRepository.findActiveMembership({
      userId,
      scope: context.type,
      scopeEntityId: context.entityId,
      customRoleId: context.customRoleId,
    });

    return Boolean(membership);
  }

  /** Guards the owner bypass: every required key must exist in the owner's scope. */
  async scopeDefinesAllPermissions(
    scope: PermissionScope,
    requiredKeys: string[],
  ): Promise<boolean> {
    if (requiredKeys.length === 0) {
      return true;
    }

    const uniqueKeys = [...new Set(requiredKeys)];
    const rows = await this.rbacRepository.findPermissionsByKeys(
      scope,
      uniqueKeys,
    );

    return rows.length === uniqueKeys.length;
  }

  async hasPermissions(
    customRoleId: string,
    requiredKeys: string[],
  ): Promise<boolean> {
    if (requiredKeys.length === 0) {
      return true;
    }

    const role = await this.rbacRepository.findCustomRoleById(customRoleId);
    if (!role) {
      return false;
    }

    if (role.kind === RoleKind.OWNER) {
      return true;
    }

    const granted =
      await this.rbacRepository.findPermissionKeysForRole(customRoleId);
    const grantedKeys = new Set(granted.map((row) => row.permission.key));

    return requiredKeys.every((key) => grantedKeys.has(key));
  }

  toContextResponse(
    memberships: Awaited<
      ReturnType<RbacRepository['findMembershipsForContext']>
    >,
  ) {
    return memberships.map((m) => ({
      type: m.scope,
      entityId: m.scopeEntityId,
      customRoleId: m.customRoleId,
      roleName: m.customRole.name,
      kind: m.customRole.kind,
    }));
  }

  ensureOwnerRole(params: {
    scope: PermissionScope;
    scopeEntityId: string;
    userId: string;
  }) {
    return this.rbacRepository.ensureOwnerRole(params);
  }

  async listPermissions(scope: PermissionScope) {
    if (!Object.values(PermissionScope).includes(scope)) {
      throw new BadRequestException('Invalid permission scope');
    }

    const data = await this.rbacRepository.findPermissionsByScope(scope);
    return { message: 'Permissions fetched successfully', data };
  }

  async listPermissionsForCaller(
    user: AuthenticatedUser,
    scope: PermissionScope,
  ) {
    if (!Object.values(PermissionScope).includes(scope)) {
      throw new BadRequestException('Invalid permission scope');
    }

    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return this.listPermissions(scope);
    }

    if (
      user.platformRole === PlatformRole.VENDOR &&
      scope !== PermissionScope.VENDOR
    ) {
      throw new ForbiddenException('Vendors can only list VENDOR permissions');
    }

    if (
      user.platformRole === PlatformRole.PROFESSIONAL &&
      scope !== PermissionScope.PROFESSIONAL
    ) {
      throw new ForbiddenException(
        'Professionals can only list PROFESSIONAL permissions',
      );
    }

    if (
      user.platformRole === PlatformRole.ADMIN &&
      scope !== PermissionScope.ADMIN
    ) {
      throw new ForbiddenException(
        'Platform staff can only list ADMIN permissions',
      );
    }

    if (!user.activeContext?.customRoleId) {
      throw new ForbiddenException(`Active ${scope} context required`);
    }

    const rolesManage =
      scope === PermissionScope.ADMIN
        ? PERMISSIONS.ADMIN.ROLES_MANAGE
        : scope === PermissionScope.VENDOR
          ? PERMISSIONS.VENDOR.ROLES_MANAGE
          : PERMISSIONS.PROFESSIONAL.ROLES_MANAGE;

    const allowed =
      user.activeContext.isOwner ||
      (await this.hasPermissions(user.activeContext.customRoleId, [
        rolesManage,
      ]));

    if (!allowed) {
      throw new ForbiddenException(`${rolesManage} permission required`);
    }

    const result = await this.listPermissions(scope);
    return {
      ...result,
      data: result.data.filter((p) => !p.isElevated),
    };
  }

  async listRoles(user: AuthenticatedUser, scope: PermissionScope) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const data = await this.rbacRepository.findRolesByScope(
      scope,
      scopeEntityId,
    );
    return { message: 'Roles fetched successfully', data };
  }

  async getRole(
    user: AuthenticatedUser,
    scope: PermissionScope,
    roleId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const role = await this.rbacRepository.findCustomRoleById(roleId);
    if (!role || role.scope !== scope || role.scopeEntityId !== scopeEntityId) {
      throw new NotFoundException('Role not found');
    }

    const { rolePermissions, ...roleData } = role;

    return {
      message: 'Role fetched successfully',
      data: {
        ...roleData,
        permissions: rolePermissions.map((rp) => rp.permission),
      },
    };
  }

  async createRole(
    user: AuthenticatedUser,
    scope: PermissionScope,
    dto: { name: string; permissionKeys: string[] },
  ) {
    if (dto.name.trim().toLowerCase() === OWNER_ROLE_NAME.toLowerCase()) {
      throw new BadRequestException(
        `Role name "${OWNER_ROLE_NAME}" is reserved`,
      );
    }
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const permissionIds = await this.resolveAssignablePermissionIds(
      user,
      scope,
      dto.permissionKeys,
    );

    const role = await this.rbacRepository.createCustomRole({
      name: dto.name,
      scope,
      scopeEntityId,
      createdById: user.userId,
      permissionIds,
    });

    return { message: 'Role created successfully', data: role };
  }

  async updateRole(
    user: AuthenticatedUser,
    scope: PermissionScope,
    roleId: string,
    dto: { name?: string; permissionKeys?: string[] },
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const role = await this.rbacRepository.findCustomRoleById(roleId);
    if (!role || role.scope !== scope || role.scopeEntityId !== scopeEntityId) {
      throw new NotFoundException('Role not found');
    }

    if (role.kind === RoleKind.OWNER) {
      throw new ForbiddenException('The Owner role cannot be edited');
    }

    if (
      dto.name &&
      dto.name.trim().toLowerCase() === OWNER_ROLE_NAME.toLowerCase()
    ) {
      throw new BadRequestException(
        `Role name "${OWNER_ROLE_NAME}" is reserved`,
      );
    }

    if (dto.permissionKeys) {
      const permissionIds = await this.resolveAssignablePermissionIds(
        user,
        scope,
        dto.permissionKeys,
      );
      await this.rbacRepository.replaceRolePermissions(roleId, permissionIds);
    }

    const updated = dto.name
      ? await this.rbacRepository.updateCustomRoleName(roleId, dto.name)
      : role;

    return { message: 'Role updated successfully', data: updated };
  }

  async deleteRole(
    user: AuthenticatedUser,
    scope: PermissionScope,
    roleId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const role = await this.rbacRepository.findCustomRoleById(roleId);
    if (!role || role.scope !== scope || role.scopeEntityId !== scopeEntityId) {
      throw new NotFoundException('Role not found');
    }

    if (role.kind === RoleKind.OWNER) {
      throw new ForbiddenException('The Owner role cannot be deleted');
    }

    const memberCount = await this.rbacRepository.countMembersForRole(roleId);
    if (memberCount > 0) {
      throw new BadRequestException(
        'Remove or reassign team members before deleting this role',
      );
    }

    await this.rbacRepository.softDeleteCustomRole(roleId);
    return { message: 'Role deleted successfully', data: null };
  }

  async listMembers(
    user: AuthenticatedUser,
    scope: PermissionScope,
    query: ListTeamMembersDto,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);

    const orderBy =
      query.sortBy === TeamMemberSortBy.NAME
        ? { user: { name: query.sortOrder } }
        : { createdAt: query.sortOrder };

    const [data, total] = await Promise.all([
      this.rbacRepository.findTeamMembers({
        scope,
        scopeEntityId,
        status: query.status,
        orderBy,
        skip,
        take,
      }),
      this.rbacRepository.countTeamMembers({
        scope,
        scopeEntityId,
        status: query.status,
      }),
    ]);

    return {
      message: 'Team members fetched successfully',
      data,
      meta: paginationMeta(page, limit, total),
    };
  }

  async updateMember(
    user: AuthenticatedUser,
    scope: PermissionScope,
    memberId: string,
    dto: { customRoleId?: string; status?: TeamMemberStatus },
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const member = await this.rbacRepository.findTeamMemberById(memberId);
    if (
      !member ||
      member.scope !== scope ||
      member.scopeEntityId !== scopeEntityId
    ) {
      throw new NotFoundException('Team member not found');
    }

    if (member.customRole.kind === RoleKind.OWNER) {
      if (dto.customRoleId) {
        throw new ForbiddenException('Cannot change the Owner membership role');
      }

      if (dto.status) {
        throw new ForbiddenException('Cannot suspend the Owner membership');
      }
    }

    if (member.userId === user.userId) {
      throw new ForbiddenException('You cannot manage your own membership');
    }

    const currentRole = await this.rbacRepository.findCustomRoleById(
      member.customRoleId,
    );
    if (!currentRole) {
      throw new ForbiddenException('Current member role not found');
    }
    await this.assertRoleAssignable(user, currentRole);

    if (dto.customRoleId) {
      const role = await this.rbacRepository.findCustomRoleById(
        dto.customRoleId,
      );
      if (
        !role ||
        role.scope !== scope ||
        role.scopeEntityId !== scopeEntityId ||
        role.kind === RoleKind.OWNER
      ) {
        throw new BadRequestException('Invalid custom role for this context');
      }

      await this.assertRoleAssignable(user, role);
    }

    const updated = await this.rbacRepository.updateTeamMember(memberId, {
      customRoleId: dto.customRoleId,
      status: dto.status,
    });

    return { message: 'Team member updated successfully', data: updated };
  }

  async removeMember(
    user: AuthenticatedUser,
    scope: PermissionScope,
    memberId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const member = await this.rbacRepository.findTeamMemberById(memberId);
    if (
      !member ||
      member.scope !== scope ||
      member.scopeEntityId !== scopeEntityId
    ) {
      throw new NotFoundException('Team member not found');
    }

    if (member.customRole.kind === RoleKind.OWNER) {
      throw new ForbiddenException('Cannot remove the Owner from the team');
    }

    if (member.userId === user.userId) {
      throw new ForbiddenException('You cannot manage your own membership');
    }

    const currentRole = await this.rbacRepository.findCustomRoleById(
      member.customRoleId,
    );
    if (!currentRole) {
      throw new ForbiddenException('Current member role not found');
    }
    await this.assertRoleAssignable(user, currentRole);

    await this.rbacRepository.softDeleteTeamMember(memberId);
    return { message: 'Team member removed successfully', data: null };
  }

  async createInvitation(
    user: AuthenticatedUser,
    scope: PermissionScope,
    dto: {
      email: string;
      customRoleId: string;
    },
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const platformRole = this.resolveInvitationLane(scope);

    const role = await this.rbacRepository.findCustomRoleById(dto.customRoleId);
    if (
      !role ||
      role.scope !== scope ||
      role.scopeEntityId !== scopeEntityId ||
      role.kind === RoleKind.OWNER
    ) {
      throw new BadRequestException('Invalid custom role for invitation');
    }

    await this.assertRoleAssignable(user, role);

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);
    if (existingUser) {
      if (
        existingUser.platformRole === PlatformRole.CUSTOMER ||
        existingUser.platformRole === PlatformRole.SUPER_ADMIN
      ) {
        throw new ConflictException(
          'This email belongs to a customer or super-admin account and cannot be invited as staff.',
        );
      }
      if (!existingUser.isActive) {
        throw new ConflictException('This account is deactivated.');
      }
      // Block if they already hold a live membership (active or suspended).
      // A different-lane staff user with no live membership is allowed — they switch lane on accept.
      await this.assertMembershipSlotFree(existingUser.id);
    }

    const now = new Date();
    const pending = await this.rbacRepository.findPendingInvitationForEmail(
      email,
      scope,
      scopeEntityId,
      now,
    );
    if (pending) {
      throw new ConflictException(
        'A pending invitation already exists for this email.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const invitation = await this.rbacRepository.createInvitation({
      email,
      tokenHash: this.hashToken(token),
      customRoleId: dto.customRoleId,
      scope,
      scopeEntityId,
      invitedById: user.userId,
      platformRole,
      expiresAt: this.invitationExpiry(now),
      now,
    });

    this.securityAudit.log({
      actorUserId: user.userId,
      actorRole: user.platformRole,
      targetType: 'INVITATION',
      targetId: invitation.id,
      action: 'INVITATION_CREATED',
      result: 'SUCCESS',
      metadata: { email, scope, scopeEntityId, platformRole },
    });

    return {
      message: 'Invitation created successfully',
      data: { ...invitation, token },
    };
  }

  async listInvitations(
    user: AuthenticatedUser,
    scope: PermissionScope,
    query: ListInvitationsDto,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const now = new Date();

    const [rows, total] = await Promise.all([
      this.rbacRepository.findInvitations({
        scope,
        scopeEntityId,
        status: query.status,
        now,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take,
      }),
      this.rbacRepository.countInvitations({
        scope,
        scopeEntityId,
        status: query.status,
        now,
      }),
    ]);

    const data = rows.map((row) => ({
      ...row,
      status:
        row.status === InvitationStatus.PENDING && row.expiresAt <= now
          ? InvitationStatus.EXPIRED
          : row.status,
    }));

    return {
      message: 'Invitations fetched successfully',
      data,
      meta: paginationMeta(page, limit, total),
    };
  }

  async revokeInvitation(
    user: AuthenticatedUser,
    scope: PermissionScope,
    invitationId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const invitation = await this.rbacRepository.findInvitationById(
      invitationId,
      scope,
      scopeEntityId,
    );
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    const now = new Date();
    if (invitation.expiresAt <= now) {
      const expired = await this.rbacRepository.expirePendingInvitation(
        invitationId,
        scope,
        scopeEntityId,
        now,
      );
      if (expired.count !== 1) {
        throw new ConflictException('Invitation is no longer pending');
      }
      throw new BadRequestException('Invitation has expired');
    }

    const revoked = await this.rbacRepository.revokePendingInvitation(
      invitationId,
      scope,
      scopeEntityId,
      now,
      invitation.updatedAt,
    );
    if (revoked.count !== 1) {
      throw new ConflictException('Invitation is no longer pending');
    }

    this.securityAudit.log({
      actorUserId: user.userId,
      actorRole: user.platformRole,
      targetType: 'INVITATION',
      targetId: invitationId,
      action: 'INVITATION_REVOKED',
      result: 'SUCCESS',
      metadata: { email: invitation.email, scope, scopeEntityId },
    });

    return { message: 'Invitation revoked successfully', data: null };
  }

  async resendInvitation(
    user: AuthenticatedUser,
    scope: PermissionScope,
    invitationId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const invitation = await this.rbacRepository.findInvitationById(
      invitationId,
      scope,
      scopeEntityId,
    );
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be resent');
    }

    const now = new Date();
    if (invitation.expiresAt <= now) {
      const expired = await this.rbacRepository.expirePendingInvitation(
        invitationId,
        scope,
        scopeEntityId,
        now,
      );
      if (expired.count !== 1) {
        throw new ConflictException('Invitation is no longer pending');
      }
      throw new BadRequestException('Invitation has expired');
    }

    const token = randomBytes(32).toString('hex');
    const updated = await this.rbacRepository.rotatePendingInvitationToken({
      id: invitationId,
      scope,
      scopeEntityId,
      tokenHash: this.hashToken(token),
      expiresAt: this.invitationExpiry(now),
      now,
      expectedUpdatedAt: invitation.updatedAt,
    });
    if (!updated) {
      throw new ConflictException('Invitation is no longer pending');
    }

    this.securityAudit.log({
      actorUserId: user.userId,
      actorRole: user.platformRole,
      targetType: 'INVITATION',
      targetId: invitationId,
      action: 'INVITATION_RESENT',
      result: 'SUCCESS',
      metadata: { email: invitation.email, scope, scopeEntityId },
    });

    return {
      message: 'Invitation resent successfully',
      data: { ...updated, token },
    };
  }

  async previewInvitation(token: string, callerUserId?: string) {
    const tokenHash = this.hashToken(token);
    const invitation =
      await this.rbacRepository.findPendingInvitationByTokenHash(tokenHash);

    if (!invitation || invitation.customRole?.deletedAt) {
      throw new NotFoundException('Invitation not found or has expired');
    }

    const now = new Date();
    if (invitation.expiresAt <= now) {
      throw new BadRequestException('Invitation has expired');
    }

    const email = invitation.email.toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);

    const hasAccount = !!existingUser;
    // Existing users always receive ACCEPT — the invite token is enough to join.
    // CREATE_ACCOUNT only when no account exists yet.
    const nextAction: 'CREATE_ACCOUNT' | 'ACCEPT' = hasAccount
      ? 'ACCEPT'
      : 'CREATE_ACCOUNT';

    // sessionOnAccept tells the client whether POST /accept will return tokens.
    // Tokens are issued when: (a) new user, or (b) caller JWT matches the invited email.
    const sessionOnAccept =
      !hasAccount || (!!callerUserId && callerUserId === existingUser?.id);

    return {
      message: 'Invitation preview fetched successfully',
      data: {
        email,
        scope: invitation.scope,
        roleName: invitation.customRole?.name ?? null,
        expiresAt: invitation.expiresAt,
        nextAction,
        hasAccount,
        /** Only name and email — enough for a "Welcome back, X" UI without exposing ids. */
        user: existingUser
          ? { name: existingUser.name, email: existingUser.email }
          : null,
        sessionOnAccept,
      },
    };
  }

  async acceptInvitation(
    dto: { token: string; name?: string; password?: string },
    callerUserId?: string,
  ) {
    const tokenHash = this.hashToken(dto.token);
    const invitation =
      await this.rbacRepository.findPendingInvitationByTokenHash(tokenHash);

    if (!invitation || invitation.customRole?.deletedAt) {
      throw new NotFoundException('Invitation not found');
    }

    const now = new Date();
    if (invitation.expiresAt <= now) {
      const expired = await this.rbacRepository.expirePendingInvitation(
        invitation.id,
        invitation.scope,
        invitation.scopeEntityId,
        now,
      );
      if (expired.count !== 1) {
        throw new ConflictException('Invitation is no longer pending');
      }
      throw new BadRequestException('Invitation has expired');
    }

    const email = invitation.email.toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);
    const platformRole = this.assertStaffLane(invitation.platformRole);

    if (existingUser) {
      if (!existingUser.isActive) {
        throw new ForbiddenException('Your account is deactivated.');
      }

      await this.assertMembershipSlotFree(existingUser.id);
    } else {
      if (!dto.name || !dto.password) {
        throw new BadRequestException(
          'Name and password are required for new staff accounts',
        );
      }
      this.assertStrongStaffPassword(dto.password);
    }

    const needsLaneSwitch =
      !!existingUser && existingUser.platformRole !== platformRole;

    const user = await this.rbacRepository.acceptInvitationTx({
      invitationId: invitation.id,
      invitationTokenHash: tokenHash,
      customRoleId: invitation.customRoleId,
      scope: invitation.scope,
      scopeEntityId: invitation.scopeEntityId,
      now,
      existingUserId: existingUser?.id,
      switchLane: needsLaneSwitch ? platformRole : undefined,
      newUser: existingUser
        ? undefined
        : {
            name: dto.name!,
            email,
            passwordHash: await bcrypt.hash(dto.password!, 10),
            platformRole,
          },
    });

    if (!user) {
      throw new BadRequestException('Invitation has expired');
    }

    // Revoke all other pending invitations for this email so dead links are cleaned up.
    await this.rbacRepository.revokePendingInvitesForEmailExcluding(
      email,
      invitation.id,
    );

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      targetType: 'INVITATION',
      targetId: invitation.id,
      action: 'INVITATION_ACCEPTED',
      result: 'SUCCESS',
      metadata: {
        scope: invitation.scope,
        scopeEntityId: invitation.scopeEntityId,
        laneSwitch: needsLaneSwitch
          ? { from: existingUser?.platformRole, to: platformRole }
          : null,
      },
    });

    const issueTokens =
      !existingUser || (!!callerUserId && callerUserId === existingUser.id);

    return {
      message: 'Invitation accepted successfully',
      isNewUser: !existingUser,
      userId: user.id,
      platformRole: user.platformRole,
      issueTokens,
      data: {
        scope: invitation.scope,
        entityId: invitation.scopeEntityId,
        customRoleId: invitation.customRoleId,
      },
    };
  }

  private requireScopeEntity(
    user: AuthenticatedUser,
    scope: PermissionScope,
  ): string | null {
    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      if (scope === PermissionScope.ADMIN) {
        return null;
      }
      throw new BadRequestException(
        'Super Admin must impersonate or use a scoped context for this action',
      );
    }

    if (!user.activeContext || user.activeContext.type !== scope) {
      throw new ForbiddenException(`Active ${scope} context required`);
    }

    return user.activeContext.entityId;
  }

  private async resolveAssignablePermissionIds(
    user: AuthenticatedUser,
    scope: PermissionScope,
    keys: string[],
  ): Promise<string[]> {
    const uniqueKeys = [...new Set(keys)];
    const permissions = await this.rbacRepository.findPermissionsByKeys(
      scope,
      uniqueKeys,
    );

    if (permissions.length !== uniqueKeys.length) {
      throw new BadRequestException('One or more permission keys are invalid');
    }

    for (const permission of permissions) {
      if (
        permission.isElevated &&
        user.platformRole !== PlatformRole.SUPER_ADMIN
      ) {
        throw new ForbiddenException(
          `Only Super Admin can assign elevated permission ${permission.key}`,
        );
      }
    }

    if (user.platformRole !== PlatformRole.SUPER_ADMIN) {
      if (!user.activeContext?.customRoleId) {
        throw new ForbiddenException('Active context required');
      }

      const actorRole = await this.rbacRepository.findCustomRoleById(
        user.activeContext.customRoleId,
      );
      if (!actorRole) {
        throw new ForbiddenException('Active role not found');
      }

      if (actorRole.kind !== RoleKind.OWNER) {
        const actorKeys = new Set(
          actorRole.rolePermissions.map((rp) => rp.permission.key),
        );
        for (const key of uniqueKeys) {
          if (!actorKeys.has(key)) {
            throw new ForbiddenException(
              `Cannot assign permission you do not have: ${key}`,
            );
          }
        }
      }
    }

    return permissions.map((p) => p.id);
  }

  private async assertRoleAssignable(
    user: AuthenticatedUser,
    role: NonNullable<
      Awaited<ReturnType<RbacRepository['findCustomRoleById']>>
    >,
  ) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return;
    }

    const targetPermissions = role.rolePermissions.map(
      ({ permission }) => permission,
    );
    if (targetPermissions.some((permission) => permission.isElevated)) {
      throw new ForbiddenException(
        'Only Super Admin can assign roles with elevated permissions',
      );
    }

    if (user.activeContext?.isOwner) {
      return;
    }

    const actorRoleId = user.activeContext?.customRoleId;
    if (!actorRoleId) {
      throw new ForbiddenException('Active role required');
    }

    const actorPermissions =
      await this.rbacRepository.findPermissionKeysForRole(actorRoleId);
    const actorKeys = new Set(
      actorPermissions.map(({ permission }) => permission.key),
    );
    const missing = targetPermissions.find(
      (permission) => !actorKeys.has(permission.key),
    );
    if (missing) {
      throw new ForbiddenException(
        `Cannot assign a role with permission you do not have: ${missing.key}`,
      );
    }
  }

  private resolveInvitationLane(scope: PermissionScope): StaffPlatformRole {
    if (scope === PermissionScope.VENDOR) {
      return PlatformRole.VENDOR;
    }

    if (scope === PermissionScope.PROFESSIONAL) {
      return PlatformRole.PROFESSIONAL;
    }

    return PlatformRole.ADMIN;
  }

  private assertStaffLane(platformRole: PlatformRole): StaffPlatformRole {
    if (
      platformRole === PlatformRole.SUPER_ADMIN ||
      platformRole === PlatformRole.CUSTOMER
    ) {
      throw new BadRequestException('Invalid invitation account lane');
    }

    return platformRole;
  }

  private invitationExpiry(now = new Date()) {
    const days = Number(
      this.config.get<string>('INVITATION_EXPIRES_IN_DAYS') ?? 7,
    );
    const validDays = Number.isFinite(days) && days > 0 ? days : 7;
    return new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
  }

  /** One non-deleted TeamMember per user, enforced by team_members_user_one_active_unique. */
  private async assertMembershipSlotFree(userId: string) {
    const slot = await this.rbacRepository.findMembershipSlot(userId);
    if (!slot) {
      return;
    }

    throw new ConflictException(
      slot.status === TeamMemberStatus.SUSPENDED
        ? 'This account is suspended in another team. That membership must be removed first.'
        : 'This account already has an active team membership.',
    );
  }

  private assertStrongStaffPassword(password: string) {
    const strong =
      password.length >= 12 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password);

    if (!strong) {
      throw new BadRequestException(
        'Staff password must be at least 12 characters and include upper, lower, number, and symbol',
      );
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
