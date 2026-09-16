import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { PlatformRole } from '../../../generated/prisma/client.js';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/types/auth-user.type';
import { PERMISSIONS } from './permissions.constants';
import { RbacRepository } from './rbac.repository';
import { RbacService } from './rbac.service';
import { SecurityAuditService } from './security-audit.service';

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly rbacRepository: RbacRepository,
    private readonly rbacService: RbacService,
    private readonly securityAudit: SecurityAuditService,
    private readonly jwtService: JwtService,
  ) {}

  async impersonate(actor: AuthenticatedUser, targetUserId: string) {
    try {
      if (actor.isImpersonation) {
        throw new ForbiddenException('Cannot impersonate while impersonating');
      }

      if (actor.platformRole !== PlatformRole.SUPER_ADMIN) {
        if (actor.platformRole !== PlatformRole.ADMIN) {
          throw new ForbiddenException(
            'Only Super Admin or elevated Admin can impersonate',
          );
        }

        if (!actor.activeContext?.customRoleId) {
          throw new ForbiddenException('Active ADMIN context required');
        }

        const allowed = await this.rbacService.hasPermissions(
          actor.activeContext.customRoleId,
          [PERMISSIONS.ADMIN.USERS_IMPERSONATE],
        );
        if (!allowed) {
          throw new ForbiddenException('users:impersonate permission required');
        }
      }

      const target = await this.rbacRepository.findUserById(targetUserId);
      if (!target) {
        throw new NotFoundException('User not found');
      }

      if (!target.isActive) {
        throw new BadRequestException('Cannot impersonate an inactive user');
      }

      if (
        target.platformRole === PlatformRole.SUPER_ADMIN ||
        target.platformRole === PlatformRole.ADMIN
      ) {
        throw new ForbiddenException('Cannot impersonate platform staff');
      }

      if (target.id === actor.userId) {
        throw new BadRequestException('Cannot impersonate yourself');
      }

      const payload: JwtPayload = {
        userId: target.id,
        platformRole: target.platformRole,
        isImpersonation: true,
        impersonatedBy: actor.userId,
      };

      const accessToken = this.jwtService.sign(payload, {
        expiresIn: '15m' as JwtSignOptions['expiresIn'],
      });

      await this.rbacRepository.createImpersonationLog({
        adminId: actor.userId,
        targetUserId: target.id,
        action: 'STARTED',
      });
      await this.securityAudit.logAwaited({
        actorUserId: actor.userId,
        actorRole: actor.platformRole,
        targetUserId: target.id,
        targetType: 'USER',
        targetId: target.id,
        action: 'IMPERSONATION_STARTED',
        result: 'SUCCESS',
      });

      const session = await this.rbacService.buildAuthSession(target.id, {
        isImpersonating: true,
      });

      return {
        message: 'Impersonation session started',
        data: {
          accessToken,
          expiresIn: 900,
          targetUserId: target.id,
          targetPlatformRole: target.platformRole,
          session,
        },
      };
    } catch (error) {
      this.securityAudit.log({
        actorUserId: actor.userId,
        actorRole: actor.platformRole,
        targetUserId,
        targetType: 'USER',
        targetId: targetUserId,
        action: 'IMPERSONATION_STARTED',
        result: 'FAILURE',
        metadata: {
          reason: error instanceof Error ? error.message : 'unknown',
        },
      });
      throw error;
    }
  }
}
