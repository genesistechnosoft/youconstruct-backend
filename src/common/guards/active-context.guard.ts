import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PermissionScope,
  PlatformRole,
} from '../../../generated/prisma/client.js';
import { ACTIVE_CONTEXT_KEY } from '../decorators/require-active-context.decorator';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class ActiveContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<PermissionScope[]>(
      ACTIVE_CONTEXT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Active context required');
    }

    if (
      user.platformRole === PlatformRole.SUPER_ADMIN &&
      requiredScopes.includes(PermissionScope.ADMIN)
    ) {
      return true;
    }

    if (
      !user.activeContext ||
      !requiredScopes.includes(user.activeContext.type)
    ) {
      throw new ForbiddenException(
        `Active context of type ${requiredScopes.join(' or ')} required`,
      );
    }

    if (user.activeContext.isSuspended) {
      throw new ForbiddenException(
        'Your team access is suspended. Contact an administrator.',
      );
    }

    return true;
  }
}
