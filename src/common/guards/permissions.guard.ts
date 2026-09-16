import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '../../../generated/prisma/client.js';
import { RbacService } from '../../modules/rbac/rbac.service';
import type { PermissionKey } from '../../modules/rbac/permissions.constants';
import { ONBOARDING_ONLY_KEY } from '../decorators/onboarding-only.decorator';
import { OWNER_ONLY_KEY } from '../decorators/owner-only.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      originalUrl?: string;
      url?: string;
    }>();
    const user = request.user;

    if (!required?.length) {
      const onboardingOnly = this.reflector.getAllAndOverride<boolean>(
        ONBOARDING_ONLY_KEY,
        [context.getHandler(), context.getClass()],
      );
      const ownerOnly = this.reflector.getAllAndOverride<boolean>(
        OWNER_ONLY_KEY,
        [context.getHandler(), context.getClass()],
      );
      const explicitRoles = this.reflector.getAllAndOverride<PlatformRole[]>(
        ROLES_KEY,
        [context.getHandler(), context.getClass()],
      );
      const path = request.originalUrl ?? request.url ?? '';
      const isDashboardRoute =
        path.includes('/vendor/') ||
        path.includes('/admin/') ||
        path.includes('/professional/');

      if (!isDashboardRoute) {
        return true;
      }

      // Explicit non-permission authorization modes
      if (onboardingOnly || ownerOnly) {
        return true;
      }

      // SUPER_ADMIN-only role routes (platform staff management)
      if (
        explicitRoles?.length &&
        explicitRoles.every((role) => role === PlatformRole.SUPER_ADMIN)
      ) {
        return true;
      }

      throw new ForbiddenException(
        'Explicit permission metadata is required for this route',
      );
    }

    if (!user) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    if (user.activeContext?.isSuspended) {
      throw new ForbiddenException(
        'Your team access is suspended. Contact an administrator.',
      );
    }

    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return true;
    }

    // Owners hold every permission in their own scope, but nothing outside it.
    if (user.activeContext?.isOwner) {
      const inScope = await this.rbacService.scopeDefinesAllPermissions(
        user.activeContext.type,
        required,
      );

      if (!inScope) {
        throw new ForbiddenException(
          'You do not have permission to access this resource',
        );
      }

      return true;
    }

    if (!user.activeContext?.customRoleId) {
      throw new ForbiddenException('Active context required');
    }

    const allowed = await this.rbacService.hasPermissions(
      user.activeContext.customRoleId,
      required,
    );

    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    return true;
  }
}
