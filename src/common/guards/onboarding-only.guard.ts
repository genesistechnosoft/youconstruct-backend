import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '../../../generated/prisma/client.js';
import { ONBOARDING_ONLY_KEY } from '../decorators/onboarding-only.decorator';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class OnboardingOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      ONBOARDING_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Onboarding access required');
    }

    if (
      user.platformRole !== PlatformRole.VENDOR &&
      user.platformRole !== PlatformRole.PROFESSIONAL
    ) {
      throw new ForbiddenException('Onboarding access required');
    }

    if (user.activeContext && !user.activeContext.isOwner) {
      throw new ForbiddenException(
        'Team members cannot access owner onboarding routes',
      );
    }

    // Removed staff keep platformRole VENDOR/PROFESSIONAL but must not onboard.
    if (user.accessRevoked) {
      throw new ForbiddenException(
        'Your team access was removed. Contact an administrator.',
      );
    }

    return true;
  }
}
