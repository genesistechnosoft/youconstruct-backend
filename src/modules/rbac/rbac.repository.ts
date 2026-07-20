import { Injectable } from '@nestjs/common';
import {
  InvitationStatus,
  PermissionScope,
  PlatformRole,
  Prisma,
  TeamMemberStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { OWNER_ROLE_NAME } from './permissions.constants';

type DbClient = Prisma.TransactionClient | PrismaService;

const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  customRoleId: true,
  scope: true,
  scopeEntityId: true,
  status: true,
  customRole: {
    select: {
      id: true,
      name: true,
      scope: true,
      isSystem: true,
      deletedAt: true,
      rolePermissions: {
        select: {
          permission: {
            select: {
              key: true,
              scope: true,
              isElevated: true,
            },
          },
        },
      },
    },
  },
} as const;

const ROLE_SELECT = {
  id: true,
  name: true,
  scope: true,
  scopeEntityId: true,
  isSystem: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

@Injectable()
export class RbacRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveMemberships(userId: string) {
    return this.prisma.teamMember.findMany({
      where: {
        userId,
        status: TeamMemberStatus.ACTIVE,
        deletedAt: null,
        customRole: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      select: MEMBERSHIP_SELECT,
    });
  }

  findOwnerVendorProfile(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        isApproved: true,
        onboardingStatus: true,
        deletedAt: true,
      },
    });
  }

  findOwnerProfessionalProfile(userId: string) {
    return this.prisma.professionalProfile.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        isApproved: true,
        isActive: true,
        deletedAt: true,
      },
    });
  }

  findActiveMembership(params: {
    userId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    customRoleId?: string;
  }) {
    return this.prisma.teamMember.findFirst({
      where: {
        userId: params.userId,
        scope: params.scope,
        scopeEntityId: params.scopeEntityId,
        status: TeamMemberStatus.ACTIVE,
        deletedAt: null,
        customRole: { deletedAt: null },
        ...(params.customRoleId && { customRoleId: params.customRoleId }),
      },
      select: MEMBERSHIP_SELECT,
    });
  }

  findCustomRoleById(customRoleId: string) {
    return this.prisma.customRole.findFirst({
      where: { id: customRoleId, deletedAt: null },
      select: {
        ...ROLE_SELECT,
        rolePermissions: {
          select: {
            permission: {
              select: {
                id: true,
                key: true,
                name: true,
                group: true,
                scope: true,
                isElevated: true,
              },
            },
          },
        },
      },
    });
  }

  findPermissionKeysForRole(customRoleId: string) {
    return this.prisma.rolePermission.findMany({
      where: { customRoleId },
      select: {
        permission: {
          select: { key: true, scope: true, isElevated: true },
        },
      },
    });
  }

  findPermissionsByScope(scope: PermissionScope) {
    return this.prisma.permission.findMany({
      where: { scope },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        group: true,
        scope: true,
        description: true,
        isElevated: true,
      },
    });
  }

  findPermissionsByKeys(scope: PermissionScope, keys: string[]) {
    return this.prisma.permission.findMany({
      where: { scope, key: { in: keys } },
      select: {
        id: true,
        key: true,
        scope: true,
        isElevated: true,
      },
    });
  }

  findRolesByScope(scope: PermissionScope, scopeEntityId: string | null) {
    return this.prisma.customRole.findMany({
      where: { scope, scopeEntityId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        ...ROLE_SELECT,
        _count: { select: { teamMembers: true, rolePermissions: true } },
      },
    });
  }

  createCustomRole(data: {
    name: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    createdById: string;
    permissionIds: string[];
    isSystem?: boolean;
  }) {
    return this.prisma.customRole.create({
      data: {
        name: data.name,
        scope: data.scope,
        scopeEntityId: data.scopeEntityId,
        createdById: data.createdById,
        isSystem: data.isSystem ?? false,
        rolePermissions: {
          create: data.permissionIds.map((permissionId) => ({
            permissionId,
          })),
        },
      },
      select: ROLE_SELECT,
    });
  }

  async replaceRolePermissions(customRoleId: string, permissionIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { customRoleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          customRoleId,
          permissionId,
        })),
      }),
    ]);
  }

  updateCustomRoleName(customRoleId: string, name: string) {
    return this.prisma.customRole.update({
      where: { id: customRoleId },
      data: { name },
      select: ROLE_SELECT,
    });
  }

  softDeleteCustomRole(customRoleId: string) {
    return this.prisma.customRole.update({
      where: { id: customRoleId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  findTeamMembers(scope: PermissionScope, scopeEntityId: string | null) {
    return this.prisma.teamMember.findMany({
      where: { scope, scopeEntityId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        ...MEMBERSHIP_SELECT,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            platformRole: true,
            isActive: true,
          },
        },
      },
    });
  }

  createTeamMember(data: {
    userId: string;
    customRoleId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
  }) {
    return this.prisma.teamMember.create({
      data: {
        userId: data.userId,
        customRoleId: data.customRoleId,
        scope: data.scope,
        scopeEntityId: data.scopeEntityId,
        status: TeamMemberStatus.ACTIVE,
      },
      select: MEMBERSHIP_SELECT,
    });
  }

  updateTeamMemberRole(teamMemberId: string, customRoleId: string) {
    return this.prisma.teamMember.update({
      where: { id: teamMemberId },
      data: { customRoleId },
      select: MEMBERSHIP_SELECT,
    });
  }

  updateTeamMemberStatus(teamMemberId: string, status: TeamMemberStatus) {
    return this.prisma.teamMember.update({
      where: { id: teamMemberId },
      data: { status },
      select: MEMBERSHIP_SELECT,
    });
  }

  softDeleteTeamMember(teamMemberId: string) {
    return this.prisma.teamMember.update({
      where: { id: teamMemberId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  findTeamMemberById(id: string) {
    return this.prisma.teamMember.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...MEMBERSHIP_SELECT,
        user: {
          select: {
            id: true,
            email: true,
            platformRole: true,
          },
        },
      },
    });
  }

  createInvitation(data: {
    email: string;
    tokenHash: string;
    customRoleId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    invitedById: string;
    expiresAt: Date;
    platformRole?: PlatformRole;
  }) {
    return this.prisma.invitation.create({
      data: {
        ...data,
        status: InvitationStatus.PENDING,
      },
      select: {
        id: true,
        email: true,
        scope: true,
        scopeEntityId: true,
        customRoleId: true,
        platformRole: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  findPendingInvitationByTokenHash(tokenHash: string) {
    return this.prisma.invitation.findFirst({
      where: {
        tokenHash,
        status: InvitationStatus.PENDING,
      },
      select: {
        id: true,
        email: true,
        customRoleId: true,
        platformRole: true,
        scope: true,
        scopeEntityId: true,
        invitedById: true,
        status: true,
        expiresAt: true,
        customRole: {
          select: { id: true, name: true, isSystem: true, deletedAt: true },
        },
      },
    });
  }

  findInvitations(scope: PermissionScope, scopeEntityId: string | null) {
    return this.prisma.invitation.findMany({
      where: { scope, scopeEntityId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
        customRole: { select: { id: true, name: true } },
      },
    });
  }

  updateInvitationStatus(
    id: string,
    status: InvitationStatus,
    acceptedAt?: Date,
    acceptedById?: string,
  ) {
    return this.prisma.invitation.update({
      where: { id },
      data: {
        status,
        ...(acceptedAt && { acceptedAt }),
        ...(acceptedById && { acceptedById }),
      },
      select: { id: true, status: true },
    });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        isActive: true,
      },
    });
  }

  findUserById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        isActive: true,
      },
    });
  }

  createStaffUser(data: {
    name: string;
    email: string;
    passwordHash: string;
    platformRole:
      | typeof PlatformRole.VENDOR
      | typeof PlatformRole.PROFESSIONAL
      | typeof PlatformRole.ADMIN
      | typeof PlatformRole.SUPPORT;
  }) {
    return this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        platformRole: data.platformRole,
        isEmailVerified: true,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        isActive: true,
      },
    });
  }

  countActiveMemberships(userId: string) {
    return this.prisma.teamMember.count({
      where: {
        userId,
        deletedAt: null,
      },
    });
  }

  findVendorOnboardingByUserId(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, onboardingStatus: true },
    });
  }

  createImpersonationLog(data: {
    adminId: string;
    targetUserId: string;
    action: string;
    method?: string;
    path?: string;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.impersonationLog.create({
      data,
      select: { id: true },
    });
  }

  createSecurityAuditLog(data: {
    actorUserId?: string;
    actorRole?: PlatformRole;
    targetUserId?: string;
    targetType?: string;
    targetId?: string;
    action: string;
    result: string;
    method?: string;
    path?: string;
    ip?: string;
    userAgent?: string;
    metadata?: Prisma.InputJsonValue;
    impersonatedBy?: string;
  }) {
    return this.prisma.securityAuditLog.create({
      data,
      select: { id: true },
    });
  }

  /**
   * Idempotent: creates system Owner role + all scope permissions + TeamMember.
   */
  async ensureOwnerRole(
    params: {
      scope: PermissionScope;
      scopeEntityId: string;
      userId: string;
    },
    tx?: DbClient,
  ) {
    const db = tx ?? this.prisma;

    let role = await db.customRole.findFirst({
      where: {
        name: OWNER_ROLE_NAME,
        scope: params.scope,
        scopeEntityId: params.scopeEntityId,
        isSystem: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!role) {
      role = await db.customRole.create({
        data: {
          name: OWNER_ROLE_NAME,
          scope: params.scope,
          scopeEntityId: params.scopeEntityId,
          isSystem: true,
        },
        select: { id: true },
      });
    }

    const permissions = await db.permission.findMany({
      where: { scope: params.scope },
      select: { id: true },
    });

    for (const permission of permissions) {
      await db.rolePermission.upsert({
        where: {
          customRoleId_permissionId: {
            customRoleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          customRoleId: role.id,
          permissionId: permission.id,
        },
      });
    }

    const existingMember = await db.teamMember.findFirst({
      where: {
        userId: params.userId,
        scope: params.scope,
        scopeEntityId: params.scopeEntityId,
        deletedAt: null,
      },
      select: { id: true, customRoleId: true },
    });

    if (!existingMember) {
      await db.teamMember.create({
        data: {
          userId: params.userId,
          customRoleId: role.id,
          scope: params.scope,
          scopeEntityId: params.scopeEntityId,
          status: TeamMemberStatus.ACTIVE,
        },
        select: { id: true },
      });
    } else if (existingMember.customRoleId !== role.id) {
      await db.teamMember.update({
        where: { id: existingMember.id },
        data: { customRoleId: role.id, status: TeamMemberStatus.ACTIVE },
        select: { id: true },
      });
    }

    return role;
  }
}
