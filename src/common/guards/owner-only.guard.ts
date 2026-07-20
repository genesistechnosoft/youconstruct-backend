import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '../../../generated/prisma/client.js';
import { OWNER_ONLY_KEY } from '../decorators/owner-only.decorator';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(OWNER_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Owner access required');
    }

    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return true;
    }

    if (!user.activeContext?.isOwner) {
      throw new ForbiddenException('Owner access required');
    }

    return true;
  }
}
