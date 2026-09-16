import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationStatus,
  PermissionScope,
  PlatformRole,
  Prisma,
  RoleKind,
  TeamMemberStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { OWNER_ROLE_NAME } from './permissions.constants';

type DbClient = Prisma.TransactionClient | PrismaService;

/** team_members_user_one_active_unique allows one non-deleted membership per user. */
const MEMBERSHIP_SLOT_CONFLICT =
  'This account already belongs to a team. Remove the existing membership first.';

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
      kind: true,
      deletedAt: true,
    },
  },
} as const;

const MEMBER_LIST_SELECT = {
  ...MEMBERSHIP_SELECT,
  createdAt: true,
  customRole: {
    select: {
      ...MEMBERSHIP_SELECT.customRole.select,
      _count: { select: { rolePermissions: true } },
    },
  },
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
} as const;

const ROLE_SELECT = {
  id: true,
  name: true,
  scope: true,
  scopeEntityId: true,
  kind: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

@Injectable()
export class RbacRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Includes SUSPENDED so the session can explain revoked access; guards reject it. */
  findMembershipsForContext(userId: string) {
    return this.prisma.teamMember.findMany({
      where: {
        userId,
        deletedAt: null,
        customRole: { deletedAt: null },
      },
      orderBy: { createdAt: 'asc' },
      select: MEMBERSHIP_SELECT,
    });
  }

  /** Counts removed memberships too, to tell ex-staff apart from owners yet to onboard. */
  countMembershipHistory(userId: string) {
    return this.prisma.teamMember.count({ where: { userId } });
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
      where: { customRoleId, customRole: { deletedAt: null } },
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
        _count: {
          select: {
            teamMembers: { where: { deletedAt: null } },
            rolePermissions: true,
          },
        },
      },
    });
  }

  async createCustomRole(data: {
    name: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    createdById: string;
    permissionIds: string[];
    kind?: RoleKind;
  }) {
    try {
      return await this.prisma.customRole.create({
        data: {
          name: data.name,
          scope: data.scope,
          scopeEntityId: data.scopeEntityId,
          createdById: data.createdById,
          kind: data.kind ?? RoleKind.CUSTOM,
          rolePermissions: {
            create: data.permissionIds.map((permissionId) => ({
              permissionId,
            })),
          },
        },
        select: ROLE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, 'A role with this name already exists');
    }
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

  async updateCustomRoleName(customRoleId: string, name: string) {
    try {
      return await this.prisma.customRole.update({
        where: { id: customRoleId },
        data: { name },
        select: ROLE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, 'A role with this name already exists');
    }
  }

  softDeleteCustomRole(customRoleId: string) {
    return this.prisma.customRole.update({
      where: { id: customRoleId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  findTeamMembers(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: TeamMemberStatus;
    orderBy: Prisma.TeamMemberOrderByWithRelationInput;
    skip: number;
    take: number;
  }) {
    return this.prisma.teamMember.findMany({
      where: this.teamMemberWhere(params),
      orderBy: params.orderBy,
      skip: params.skip,
      take: params.take,
      select: MEMBER_LIST_SELECT,
    });
  }

  countTeamMembers(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: TeamMemberStatus;
  }) {
    return this.prisma.teamMember.count({
      where: this.teamMemberWhere(params),
    });
  }

  private teamMemberWhere(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: TeamMemberStatus;
  }): Prisma.TeamMemberWhereInput {
    return {
      scope: params.scope,
      scopeEntityId: params.scopeEntityId,
      deletedAt: null,
      ...(params.status && { status: params.status }),
    };
  }

  async createTeamMember(data: {
    userId: string;
    customRoleId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
  }) {
    try {
      return await this.prisma.teamMember.create({
        data: {
          userId: data.userId,
          customRoleId: data.customRoleId,
          scope: data.scope,
          scopeEntityId: data.scopeEntityId,
          status: TeamMemberStatus.ACTIVE,
        },
        select: MEMBERSHIP_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, MEMBERSHIP_SLOT_CONFLICT);
    }
  }

  async updateTeamMember(
    teamMemberId: string,
    data: { customRoleId?: string; status?: TeamMemberStatus },
  ) {
    try {
      return await this.prisma.teamMember.update({
        where: { id: teamMemberId },
        data: {
          ...(data.customRoleId && { customRoleId: data.customRoleId }),
          ...(data.status && { status: data.status }),
        },
        select: MEMBER_LIST_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, MEMBERSHIP_SLOT_CONFLICT);
    }
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

  async createInvitation(data: {
    email: string;
    tokenHash: string;
    customRoleId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    invitedById: string;
    expiresAt: Date;
    platformRole: PlatformRole;
    now: Date;
  }) {
    const { now, ...invitationData } = data;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.invitation.updateMany({
          where: {
            email: data.email,
            scope: data.scope,
            scopeEntityId: data.scopeEntityId,
            status: InvitationStatus.PENDING,
            expiresAt: { lte: now },
          },
          data: { status: InvitationStatus.EXPIRED },
        });

        return tx.invitation.create({
          data: {
            ...invitationData,
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
      });
    } catch (error) {
      this.handlePrismaError(
        error,
        'A pending invitation already exists for this email',
      );
    }
  }

  findPendingInvitationForEmail(
    email: string,
    scope: PermissionScope,
    scopeEntityId: string | null,
    now: Date,
  ) {
    return this.prisma.invitation.findFirst({
      where: {
        email,
        scope,
        scopeEntityId,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
  }

  findInvitationById(
    id: string,
    scope: PermissionScope,
    scopeEntityId: string | null,
  ) {
    return this.prisma.invitation.findFirst({
      where: { id, scope, scopeEntityId },
      select: {
        id: true,
        status: true,
        email: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        customRole: { select: { id: true, name: true } },
      },
    });
  }

  expirePendingInvitation(
    id: string,
    scope: PermissionScope,
    scopeEntityId: string | null,
    now: Date,
  ) {
    return this.prisma.invitation.updateMany({
      where: {
        id,
        scope,
        scopeEntityId,
        status: InvitationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: { status: InvitationStatus.EXPIRED },
    });
  }

  revokePendingInvitation(
    id: string,
    scope: PermissionScope,
    scopeEntityId: string | null,
    now: Date,
    expectedUpdatedAt: Date,
  ) {
    return this.prisma.invitation.updateMany({
      where: {
        id,
        scope,
        scopeEntityId,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: now },
        updatedAt: expectedUpdatedAt,
      },
      data: { status: InvitationStatus.REVOKED },
    });
  }

  async rotatePendingInvitationToken(params: {
    id: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
    expectedUpdatedAt: Date;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rotated = await tx.invitation.updateMany({
          where: {
            id: params.id,
            scope: params.scope,
            scopeEntityId: params.scopeEntityId,
            status: InvitationStatus.PENDING,
            expiresAt: { gt: params.now },
            updatedAt: params.expectedUpdatedAt,
          },
          data: {
            tokenHash: params.tokenHash,
            expiresAt: params.expiresAt,
          },
        });

        if (rotated.count !== 1) {
          return null;
        }

        return tx.invitation.findUnique({
          where: { id: params.id },
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
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Claims the invitation, creates the staff user when new, and grants membership.
   * When switchLane is provided the existing user's platformRole is updated in the same
   * transaction so there is never a window where the user holds a membership in a lane
   * that differs from their users.platformRole.
   * The status guard on updateMany makes a concurrent second accept roll back.
   */
  async acceptInvitationTx(params: {
    invitationId: string;
    invitationTokenHash: string;
    customRoleId: string;
    scope: PermissionScope;
    scopeEntityId: string | null;
    now: Date;
    existingUserId?: string;
    /** Update the existing user's platformRole to this value when their lane differs. */
    switchLane?: PlatformRole;
    newUser?: {
      name: string;
      email: string;
      passwordHash: string;
      platformRole:
        | typeof PlatformRole.VENDOR
        | typeof PlatformRole.PROFESSIONAL
        | typeof PlatformRole.ADMIN;
    };
  }) {
    if (!params.newUser && !params.existingUserId) {
      throw new InternalServerErrorException(
        'Invitation accept requires an existing user or new user details',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const expired = await tx.invitation.updateMany({
          where: {
            id: params.invitationId,
            status: InvitationStatus.PENDING,
            expiresAt: { lte: params.now },
          },
          data: { status: InvitationStatus.EXPIRED },
        });

        if (expired.count === 1) {
          return null;
        }

        let user = params.newUser
          ? await tx.user.create({
              data: {
                name: params.newUser.name,
                email: params.newUser.email,
                passwordHash: params.newUser.passwordHash,
                platformRole: params.newUser.platformRole,
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
            })
          : await tx.user.findFirstOrThrow({
              where: { id: params.existingUserId },
              select: {
                id: true,
                name: true,
                email: true,
                platformRole: true,
                isActive: true,
              },
            });

        if (params.switchLane && user.platformRole !== params.switchLane) {
          const updated = await tx.user.update({
            where: { id: user.id },
            data: { platformRole: params.switchLane },
            select: {
              id: true,
              name: true,
              email: true,
              platformRole: true,
              isActive: true,
            },
          });
          user = updated;
        }

        const claimed = await tx.invitation.updateMany({
          where: {
            id: params.invitationId,
            tokenHash: params.invitationTokenHash,
            status: InvitationStatus.PENDING,
            expiresAt: { gt: params.now },
          },
          data: {
            status: InvitationStatus.ACCEPTED,
            acceptedAt: params.now,
            acceptedById: user.id,
          },
        });

        if (claimed.count !== 1) {
          throw new ConflictException('Invitation has already been accepted');
        }

        await tx.teamMember.create({
          data: {
            userId: user.id,
            customRoleId: params.customRoleId,
            scope: params.scope,
            scopeEntityId: params.scopeEntityId,
            status: TeamMemberStatus.ACTIVE,
          },
          select: { id: true },
        });

        return user;
      });
    } catch (error) {
      this.handlePrismaError(error, MEMBERSHIP_SLOT_CONFLICT);
    }
  }

  /** Revokes all other PENDING invitations for the same email, called after a successful accept. */
  revokePendingInvitesForEmailExcluding(
    email: string,
    excludeInvitationId: string,
  ) {
    return this.prisma.invitation.updateMany({
      where: {
        email,
        status: InvitationStatus.PENDING,
        id: { not: excludeInvitationId },
      },
      data: { status: InvitationStatus.REVOKED },
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
          select: { id: true, name: true, kind: true, deletedAt: true },
        },
      },
    });
  }

  findInvitations(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: InvitationStatus;
    now: Date;
    orderBy: Prisma.InvitationOrderByWithRelationInput;
    skip: number;
    take: number;
  }) {
    return this.prisma.invitation.findMany({
      where: this.invitationWhere(params),
      orderBy: params.orderBy,
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        email: true,
        status: true,
        platformRole: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
        customRole: { select: { id: true, name: true } },
      },
    });
  }

  countInvitations(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: InvitationStatus;
    now: Date;
  }) {
    return this.prisma.invitation.count({
      where: this.invitationWhere(params),
    });
  }

  /** Expiry is derived, so PENDING past expiresAt has to read as EXPIRED. */
  private invitationWhere(params: {
    scope: PermissionScope;
    scopeEntityId: string | null;
    status?: InvitationStatus;
    now: Date;
  }): Prisma.InvitationWhereInput {
    const base = { scope: params.scope, scopeEntityId: params.scopeEntityId };

    if (params.status === InvitationStatus.PENDING) {
      return {
        ...base,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: params.now },
      };
    }

    if (params.status === InvitationStatus.EXPIRED) {
      return {
        ...base,
        OR: [
          { status: InvitationStatus.EXPIRED },
          {
            status: InvitationStatus.PENDING,
            expiresAt: { lte: params.now },
          },
        ],
      };
    }

    return { ...base, ...(params.status && { status: params.status }) };
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
        phone: true,
        name: true,
        platformRole: true,
        isActive: true,
      },
    });
  }

  /** Any non-deleted membership occupies the slot, matching team_members_user_one_active_unique. */
  findMembershipSlot(userId: string) {
    return this.prisma.teamMember.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        scope: true,
        scopeEntityId: true,
      },
    });
  }

  countMembersForRole(roleId: string) {
    return this.prisma.teamMember.count({
      where: { customRoleId: roleId, deletedAt: null },
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
   * Wrapped in a transaction when called without an external tx to prevent
   * concurrent registrations from creating duplicate Owner roles.
   */
  async ensureOwnerRole(
    params: {
      scope: PermissionScope;
      scopeEntityId: string;
      userId: string;
    },
    tx?: DbClient,
  ) {
    if (tx) {
      return this._ensureOwnerRoleImpl(params, tx);
    }
    return this.prisma.$transaction((transaction) =>
      this._ensureOwnerRoleImpl(params, transaction),
    );
  }

  private async _ensureOwnerRoleImpl(
    params: {
      scope: PermissionScope;
      scopeEntityId: string;
      userId: string;
    },
    db: DbClient,
  ) {
    const existingRole = await db.customRole.findFirst({
      where: {
        scope: params.scope,
        scopeEntityId: params.scopeEntityId,
        kind: RoleKind.OWNER,
        deletedAt: null,
      },
      select: { id: true },
    });

    const role =
      existingRole ??
      (await db.customRole.create({
        data: {
          name: OWNER_ROLE_NAME,
          scope: params.scope,
          scopeEntityId: params.scopeEntityId,
          kind: RoleKind.OWNER,
        },
        select: { id: true },
      }));

    const permissions = await db.permission.findMany({
      where: { scope: params.scope },
      select: { id: true },
    });

    await db.rolePermission.createMany({
      data: permissions.map((permission) => ({
        customRoleId: role.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });

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

  private handlePrismaError(
    error: unknown,
    conflictMessage = 'RBAC resource already exists',
  ): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(conflictMessage);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Resource not found');
    }

    throw error;
  }
}
