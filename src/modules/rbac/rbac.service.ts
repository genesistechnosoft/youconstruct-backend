import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import {
  InvitationStatus,
  PermissionScope,
  PlatformRole,
  TeamMemberStatus,
} from '../../../generated/prisma/client.js';
import type {
  ActiveContext,
  AuthSession,
  AuthenticatedUser,
} from '../../common/types/auth-user.type';
import { OWNER_ROLE_NAME } from './permissions.constants';
import { RbacRepository } from './rbac.repository';
import { SecurityAuditService } from './security-audit.service';

@Injectable()
export class RbacService {
  constructor(
    private readonly rbacRepository: RbacRepository,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async buildAuthSession(
    userId: string,
    opts?: { isImpersonating?: boolean },
  ): Promise<AuthSession> {
    const user = await this.rbacRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }

    const activeContext = await this.resolveRequestContext(
      user.id,
      user.platformRole,
    );

    const sessionContext = activeContext
      ? {
          type: activeContext.type,
          entityId: activeContext.entityId,
          customRoleId: activeContext.customRoleId,
          roleName: activeContext.roleName ?? '',
          isOwner: activeContext.isOwner ?? false,
        }
      : null;

    const permissions = await this.resolveSessionPermissions(
      user.platformRole,
      sessionContext,
    );

    const needsOnboarding =
      (user.platformRole === PlatformRole.VENDOR ||
        user.platformRole === PlatformRole.PROFESSIONAL) &&
      sessionContext === null;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      },
      activeContext: sessionContext,
      permissions,
      flags: {
        needsOnboarding,
        isImpersonating: opts?.isImpersonating ?? false,
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
    if (
      platformRole === PlatformRole.SUPER_ADMIN ||
      platformRole === PlatformRole.CUSTOMER
    ) {
      return undefined;
    }

    const memberships = await this.rbacRepository.findActiveMemberships(userId);
    if (memberships.length > 1) {
      throw new UnauthorizedException('Invalid account membership state');
    }

    const membership = memberships[0];
    if (!membership) {
      return undefined;
    }

    return {
      type: membership.scope,
      entityId: membership.scopeEntityId,
      customRoleId: membership.customRoleId,
      roleName: membership.customRole.name,
      isOwner:
        membership.customRole.isSystem &&
        membership.customRole.name === OWNER_ROLE_NAME &&
        membership.scope !== PermissionScope.ADMIN,
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

    if (
      role.isSystem &&
      role.name === OWNER_ROLE_NAME &&
      role.scope !== PermissionScope.ADMIN
    ) {
      return true;
    }

    const granted =
      await this.rbacRepository.findPermissionKeysForRole(customRoleId);
    const grantedKeys = new Set(granted.map((row) => row.permission.key));

    return requiredKeys.every((key) => grantedKeys.has(key));
  }

  toContextResponse(
    memberships: Awaited<ReturnType<RbacRepository['findActiveMemberships']>>,
  ) {
    return memberships.map((m) => ({
      type: m.scope,
      entityId: m.scopeEntityId,
      customRoleId: m.customRoleId,
      roleName: m.customRole.name,
      isSystem: m.customRole.isSystem,
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
      (user.platformRole === PlatformRole.ADMIN ||
        user.platformRole === PlatformRole.SUPPORT) &&
      scope !== PermissionScope.ADMIN
    ) {
      throw new ForbiddenException(
        'Platform staff can only list ADMIN permissions',
      );
    }

    if (
      user.platformRole === PlatformRole.VENDOR ||
      user.platformRole === PlatformRole.PROFESSIONAL
    ) {
      if (!user.activeContext?.customRoleId) {
        throw new ForbiddenException('Active context required');
      }
      const allowed = await this.hasPermissions(
        user.activeContext.customRoleId,
        [
          user.platformRole === PlatformRole.VENDOR
            ? 'roles:manage'
            : 'roles:manage',
        ],
      );
      if (!allowed && !user.activeContext.isOwner) {
        throw new ForbiddenException('roles:manage permission required');
      }
    }

    if (
      user.platformRole === PlatformRole.ADMIN ||
      user.platformRole === PlatformRole.SUPPORT
    ) {
      if (!user.activeContext?.customRoleId) {
        throw new ForbiddenException('Active ADMIN context required');
      }
      const allowed = await this.hasPermissions(
        user.activeContext.customRoleId,
        ['roles:manage'],
      );
      if (!allowed) {
        throw new ForbiddenException('roles:manage permission required');
      }
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
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const permissionIds = await this.resolveAssignablePermissionIds(
      user,
      scope,
      dto.permissionKeys,
    );

    try {
      const role = await this.rbacRepository.createCustomRole({
        name: dto.name,
        scope,
        scopeEntityId,
        createdById: user.userId,
        permissionIds,
      });

      return { message: 'Role created successfully', data: role };
    } catch {
      throw new ConflictException('A role with this name already exists');
    }
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

    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be edited');
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

    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted');
    }

    const members = await this.rbacRepository.findTeamMembers(
      scope,
      scopeEntityId,
    );
    if (members.some((m) => m.customRoleId === roleId)) {
      throw new BadRequestException(
        'Remove or reassign team members before deleting this role',
      );
    }

    await this.rbacRepository.softDeleteCustomRole(roleId);
    return { message: 'Role deleted successfully', data: null };
  }

  async listMembers(user: AuthenticatedUser, scope: PermissionScope) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const data = await this.rbacRepository.findTeamMembers(
      scope,
      scopeEntityId,
    );
    return { message: 'Team members fetched successfully', data };
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

    if (member.customRole.isSystem) {
      if (dto.customRoleId) {
        throw new ForbiddenException('Cannot change the Owner membership role');
      }

      if (dto.status) {
        throw new ForbiddenException('Cannot suspend the Owner membership');
      }
    }

    if (dto.customRoleId) {
      const role = await this.rbacRepository.findCustomRoleById(
        dto.customRoleId,
      );
      if (
        !role ||
        role.scope !== scope ||
        role.scopeEntityId !== scopeEntityId ||
        role.isSystem
      ) {
        throw new BadRequestException('Invalid custom role for this context');
      }
      await this.rbacRepository.updateTeamMemberRole(
        memberId,
        dto.customRoleId,
      );
    }

    if (dto.status) {
      await this.rbacRepository.updateTeamMemberStatus(memberId, dto.status);
    }

    const updated = await this.rbacRepository.findTeamMemberById(memberId);
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

    if (member.customRole.isSystem) {
      throw new ForbiddenException('Cannot remove the Owner from the team');
    }

    await this.rbacRepository.softDeleteTeamMember(memberId);
    return { message: 'Team member removed successfully', data: null };
  }

  async createInvitation(
    user: AuthenticatedUser,
    scope: PermissionScope,
    dto: { email: string; customRoleId: string },
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const role = await this.rbacRepository.findCustomRoleById(dto.customRoleId);
    if (
      !role ||
      role.scope !== scope ||
      role.scopeEntityId !== scopeEntityId ||
      role.isSystem
    ) {
      throw new BadRequestException('Invalid custom role for invitation');
    }

    const email = dto.email.toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);
    const platformRole = this.platformRoleForScope(scope);
    if (existingUser && existingUser.platformRole !== platformRole) {
      throw new ConflictException(
        'Email already belongs to a different account lane.',
      );
    }

    if (existingUser) {
      const membershipCount = await this.rbacRepository.countActiveMemberships(
        existingUser.id,
      );
      if (membershipCount > 0) {
        throw new ConflictException(
          'Email already has an active team membership.',
        );
      }
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const invitation = await this.rbacRepository.createInvitation({
      email,
      tokenHash,
      customRoleId: dto.customRoleId,
      scope,
      scopeEntityId,
      invitedById: user.userId,
      platformRole,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    this.securityAudit.log({
      actorUserId: user.userId,
      actorRole: user.platformRole,
      targetType: 'INVITATION',
      targetId: invitation.id,
      action: 'INVITATION_CREATED',
      result: 'SUCCESS',
      metadata: { email, scope, scopeEntityId },
    });

    // TODO: send invitation email with token
    return {
      message: 'Invitation created successfully',
      data: { ...invitation, token },
    };
  }

  async listInvitations(user: AuthenticatedUser, scope: PermissionScope) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const data = await this.rbacRepository.findInvitations(
      scope,
      scopeEntityId,
    );
    return { message: 'Invitations fetched successfully', data };
  }

  async revokeInvitation(
    user: AuthenticatedUser,
    scope: PermissionScope,
    invitationId: string,
  ) {
    const scopeEntityId = this.requireScopeEntity(user, scope);
    const invitations = await this.rbacRepository.findInvitations(
      scope,
      scopeEntityId,
    );
    const invitation = invitations.find((i) => i.id === invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    await this.rbacRepository.updateInvitationStatus(
      invitationId,
      InvitationStatus.REVOKED,
    );
    return { message: 'Invitation revoked successfully', data: null };
  }

  async acceptInvitation(
    dto: {
      token: string;
      name?: string;
      password?: string;
      existingAccount?: boolean;
    },
    actor?: AuthenticatedUser,
  ) {
    const tokenHash = this.hashToken(dto.token);
    const invitation =
      await this.rbacRepository.findPendingInvitationByTokenHash(tokenHash);

    if (!invitation || invitation.customRole?.deletedAt) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.expiresAt < new Date()) {
      await this.rbacRepository.updateInvitationStatus(
        invitation.id,
        InvitationStatus.EXPIRED,
      );
      throw new BadRequestException('Invitation has expired');
    }

    const email = invitation.email.toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);
    const platformRole = this.staffPlatformRoleForInvitation(
      invitation.scope,
      invitation.platformRole,
    );

    if (existingUser) {
      if (!actor || actor.userId !== existingUser.id) {
        throw new ForbiddenException(
          'Login as the invited account before accepting this invitation',
        );
      }

      if (existingUser.platformRole !== platformRole) {
        throw new ConflictException(
          'Invitation belongs to a different account lane',
        );
      }

      const membershipCount = await this.rbacRepository.countActiveMemberships(
        existingUser.id,
      );
      if (membershipCount > 0) {
        throw new ConflictException(
          'Account already has an active team membership',
        );
      }
    } else {
      if (!dto.name || !dto.password) {
        throw new BadRequestException(
          'Name and password are required for new staff accounts',
        );
      }
      this.assertStrongStaffPassword(dto.password);
    }

    const user =
      existingUser ??
      (await this.rbacRepository.createStaffUser({
        name: dto.name!,
        email,
        passwordHash: await bcrypt.hash(dto.password!, 10),
        platformRole,
      }));

    await this.rbacRepository.createTeamMember({
      userId: user.id,
      customRoleId: invitation.customRoleId,
      scope: invitation.scope,
      scopeEntityId: invitation.scopeEntityId,
    });

    await this.rbacRepository.updateInvitationStatus(
      invitation.id,
      InvitationStatus.ACCEPTED,
      new Date(),
      user.id,
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
      },
    });

    return {
      message: 'Invitation accepted successfully',
      data: {
        scope: invitation.scope,
        entityId: invitation.scopeEntityId,
        customRoleId: invitation.customRoleId,
      },
    };
  }

  async assignStaff(
    actor: AuthenticatedUser,
    dto: {
      email: string;
      platformRole: 'ADMIN' | 'SUPPORT';
      customRoleId: string;
    },
  ) {
    if (actor.platformRole !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only Super Admin can invite platform staff',
      );
    }

    const role = await this.rbacRepository.findCustomRoleById(dto.customRoleId);
    if (
      !role ||
      role.scope !== PermissionScope.ADMIN ||
      role.scopeEntityId !== null
    ) {
      throw new BadRequestException('Invalid admin custom role');
    }

    const email = dto.email.toLowerCase();
    const existingUser = await this.rbacRepository.findUserByEmail(email);
    if (existingUser) {
      throw new ConflictException(
        'Email already registered. Use a different email for this role.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const invitation = await this.rbacRepository.createInvitation({
      email,
      tokenHash: this.hashToken(token),
      customRoleId: dto.customRoleId,
      scope: PermissionScope.ADMIN,
      scopeEntityId: null,
      invitedById: actor.userId,
      platformRole: dto.platformRole,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return {
      message: 'Platform staff invitation created successfully',
      data: { ...invitation, token, platformRole: dto.platformRole },
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

      if (
        !(
          actorRole.isSystem &&
          actorRole.name === OWNER_ROLE_NAME &&
          actorRole.scope !== PermissionScope.ADMIN
        )
      ) {
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

  private platformRoleForScope(scope: PermissionScope) {
    if (scope === PermissionScope.VENDOR) {
      return PlatformRole.VENDOR;
    }
    if (scope === PermissionScope.PROFESSIONAL) {
      return PlatformRole.PROFESSIONAL;
    }
    return PlatformRole.SUPPORT;
  }

  private staffPlatformRoleForInvitation(
    scope: PermissionScope,
    storedRole?: PlatformRole | null,
  ):
    | typeof PlatformRole.ADMIN
    | typeof PlatformRole.SUPPORT
    | typeof PlatformRole.VENDOR
    | typeof PlatformRole.PROFESSIONAL {
    const platformRole = storedRole ?? this.platformRoleForScope(scope);
    if (
      platformRole === PlatformRole.SUPER_ADMIN ||
      platformRole === PlatformRole.CUSTOMER
    ) {
      throw new BadRequestException('Invalid invitation account lane');
    }

    return platformRole;
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
