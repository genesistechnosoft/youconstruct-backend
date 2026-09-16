import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RbacService } from '../../rbac/rbac.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../../common/types/auth-user.type';
import { AuthRepository } from '../auth.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authRepository: AuthRepository,
    private readonly rbacService: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authRepository.findUserById(payload.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }

    const authenticated: AuthenticatedUser = {
      userId: user.id,
      platformRole: user.platformRole,
    };

    if (payload.isImpersonation) {
      authenticated.isImpersonation = true;
      authenticated.impersonatedBy = payload.impersonatedBy;
    }

    const { context, accessRevoked } =
      await this.rbacService.resolveMembershipState(user.id, user.platformRole);

    if (context) {
      authenticated.activeContext = context;
    }
    if (accessRevoked) {
      authenticated.accessRevoked = true;
    }

    return authenticated;
  }
}
