import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PlatformRole,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { RbacRepository } from '../../modules/rbac/rbac.repository';
import { ONBOARDING_ONLY_KEY } from '../decorators/onboarding-only.decorator';
import type { AuthenticatedUser } from '../types/auth-user.type';

@Injectable()
export class OnboardingOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacRepository: RbacRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (user.platformRole === PlatformRole.VENDOR) {
      const profile = await this.rbacRepository.findVendorOnboardingByUserId(
        user.userId,
      );

      if (!profile) {
        return true;
      }

      if (profile.onboardingStatus === VendorOnboardingStatus.APPROVED) {
        throw new ForbiddenException(
          'Onboarding complete; use the approved vendor dashboard',
        );
      }
    }

    return true;
  }
}
