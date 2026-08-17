import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { PlatformRole } from '../../../generated/prisma/client.js';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/types/auth-user.type';
import { RbacService } from '../rbac/rbac.service';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { AuthRepository } from './auth.repository';

const BLOCKED_REGISTER_ROLES: PlatformRole[] = [
  PlatformRole.SUPER_ADMIN,
  PlatformRole.ADMIN,
  PlatformRole.SUPPORT,
];

const DASHBOARD_ROLES: PlatformRole[] = [
  PlatformRole.VENDOR,
  PlatformRole.PROFESSIONAL,
  PlatformRole.ADMIN,
  PlatformRole.SUPPORT,
  PlatformRole.SUPER_ADMIN,
];

const OTP_MAX_FAILURES = 3;
const OTP_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_RESET_PURPOSE = 'RESET_PASSWORD';
const PASSWORD_RESET_EXPIRES_IN = '10m';
const STEP_UP_EXPIRES_IN = '5m';
const STEP_UP_PURPOSES = ['BANK_ACCOUNT_CHANGE', 'PAYOUT_REQUEST'] as const;

type PasswordResetJwtPayload = {
  userId: string;
  purpose: typeof PASSWORD_RESET_PURPOSE;
  iat?: number;
};

type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

type StepUpJwtPayload = {
  userId: string;
  purpose: StepUpPurpose;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly rbacService: RbacService,
    private readonly securityAudit: SecurityAuditService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: {
    name: string;
    email?: string;
    phone?: string;
    password?: string;
    platformRole?: PlatformRole;
  }) {
    if (dto.platformRole && BLOCKED_REGISTER_ROLES.includes(dto.platformRole)) {
      throw new ForbiddenException('This role cannot self-register');
    }

    const platformRole = dto.platformRole ?? PlatformRole.CUSTOMER;
    const email = this.normalizeOptional(dto.email);
    const phone = this.normalizeOptional(dto.phone);

    if (phone) {
      throw new BadRequestException(
        'Phone registration requires OTP. Use POST /auth/otp/send with purpose REGISTER, then /auth/otp/verify',
      );
    }

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    if (!dto.password) {
      throw new BadRequestException('Password is required');
    }

    this.assertStrongPassword(dto.password, platformRole);

    const existingEmail = await this.authRepository.findUserByEmail(email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.authRepository.createUser({
      name: dto.name,
      email,
      passwordHash,
      platformRole,
      provider: 'EMAIL',
    });

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'REGISTER',
      result: 'SUCCESS',
      targetType: 'USER',
      targetId: user.id,
    });

    return this.generateTokens(user.id, user.platformRole);
  }

  async login(dto: { email?: string; phone?: string; password: string }) {
    const email = this.normalizeOptional(dto.email);
    const phone = this.normalizeOptional(dto.phone);
    this.assertExactlyOneContact(email, phone);

    const user = await this.authenticateWithPassword({
      email,
      phone,
      password: dto.password,
    });

    if (user.platformRole !== PlatformRole.CUSTOMER) {
      this.securityAudit.log({
        actorUserId: user.id,
        actorRole: user.platformRole,
        action: 'LOGIN',
        result: 'FAILURE',
        metadata: { reason: 'wrong_lane', lane: 'customer' },
      });
      throw new ForbiddenException('Use the dashboard login for this account');
    }

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'LOGIN',
      result: 'SUCCESS',
      metadata: { lane: 'customer' },
    });

    return this.generateTokens(user.id, user.platformRole);
  }

  async dashboardLogin(dto: { email: string; password: string }) {
    const user = await this.authenticateWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (!DASHBOARD_ROLES.includes(user.platformRole)) {
      this.securityAudit.log({
        actorUserId: user.id,
        actorRole: user.platformRole,
        action: 'LOGIN',
        result: 'FAILURE',
        metadata: { reason: 'wrong_lane', lane: 'dashboard' },
      });
      throw new ForbiddenException(
        'Use the customer app login for this account',
      );
    }

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'LOGIN',
      result: 'SUCCESS',
      metadata: { lane: 'dashboard' },
    });

    return this.generateTokens(user.id, user.platformRole);
  }

  async sendOtp(dto: { phone: string; purpose: string }) {
    await this.assertOtpNotLocked(dto.phone, dto.purpose);

    const existingUser = await this.authRepository.findUserByPhone(dto.phone);

    if (dto.purpose === 'REGISTER' && existingUser) {
      return this.genericOtpResponse();
    }

    if (
      (dto.purpose === 'LOGIN' || dto.purpose === PASSWORD_RESET_PURPOSE) &&
      !existingUser
    ) {
      return this.genericOtpResponse();
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.authRepository.invalidateUnverifiedOtps(dto.phone, dto.purpose);
    await this.authRepository.createOtp({
      target: dto.phone,
      otp: otpHash,
      purpose: dto.purpose,
      expiresAt,
      userId: existingUser?.id,
    });

    // TODO: inject Twilio client and send OTP without logging secret values.
    return this.genericOtpResponse(otp);
  }

  async verifyOtp(dto: { phone: string; otp: string; purpose: string }) {
    await this.assertOtpNotLocked(dto.phone, dto.purpose);

    const record = await this.authRepository.findLatestOtp(
      dto.phone,
      dto.purpose,
    );

    if (!record) {
      throw new BadRequestException('OTP not found');
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException('OTP has expired');
    }

    const isMatch = await bcrypt.compare(dto.otp, record.otp);
    if (!isMatch) {
      await this.authRepository.incrementOtpAttempts(record.id);
      this.securityAudit.log({
        action: 'OTP_VERIFY',
        result: 'FAILURE',
        metadata: { phone: dto.phone, purpose: dto.purpose },
      });
      throw new BadRequestException('Invalid OTP');
    }

    await this.authRepository.markOtpVerified(record.id);

    const existingUser = await this.authRepository.findUserByPhone(dto.phone);

    if (dto.purpose === 'REGISTER') {
      if (existingUser) {
        throw new ConflictException('Phone already registered');
      }

      const user = await this.authRepository.createUser({
        name: dto.phone,
        phone: dto.phone,
        provider: 'PHONE',
        platformRole: PlatformRole.CUSTOMER,
      });
      await this.authRepository.markPhoneVerified(user.id);

      this.securityAudit.log({
        actorUserId: user.id,
        actorRole: user.platformRole,
        action: 'OTP_VERIFY',
        result: 'SUCCESS',
        metadata: { purpose: 'REGISTER' },
      });

      return this.generateTokens(user.id, user.platformRole);
    }

    if (dto.purpose === 'LOGIN') {
      if (!existingUser || !existingUser.isActive) {
        throw new UnauthorizedException('Invalid credentials');
      }
      if (existingUser.platformRole !== PlatformRole.CUSTOMER) {
        throw new ForbiddenException(
          'Use the dashboard login for this account',
        );
      }

      await this.authRepository.markPhoneVerified(existingUser.id);

      this.securityAudit.log({
        actorUserId: existingUser.id,
        actorRole: existingUser.platformRole,
        action: 'OTP_VERIFY',
        result: 'SUCCESS',
        metadata: { purpose: 'LOGIN' },
      });

      return this.generateTokens(existingUser.id, existingUser.platformRole);
    }

    if (dto.purpose === PASSWORD_RESET_PURPOSE) {
      if (!existingUser || !existingUser.isActive) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const passwordResetToken = this.jwtService.sign(
        {
          userId: existingUser.id,
          purpose: PASSWORD_RESET_PURPOSE,
        } satisfies PasswordResetJwtPayload,
        {
          expiresIn: PASSWORD_RESET_EXPIRES_IN,
          secret: this.config.getOrThrow<string>('JWT_SECRET'),
        },
      );

      this.securityAudit.log({
        actorUserId: existingUser.id,
        actorRole: existingUser.platformRole,
        action: 'OTP_VERIFY',
        result: 'SUCCESS',
        metadata: { purpose: PASSWORD_RESET_PURPOSE },
      });

      return {
        message: 'OTP verified successfully',
        data: { passwordResetToken },
      };
    }

    throw new BadRequestException('Unsupported OTP purpose');
  }

  async resetPassword(dto: {
    passwordResetToken: string;
    newPassword: string;
  }) {
    let payload: PasswordResetJwtPayload;
    try {
      payload = this.jwtService.verify<PasswordResetJwtPayload>(
        dto.passwordResetToken,
        { secret: this.config.getOrThrow<string>('JWT_SECRET') },
      );
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    if (payload.purpose !== PASSWORD_RESET_PURPOSE || !payload.userId) {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    const user = await this.authRepository.findUserWithPasswordById(
      payload.userId,
    );
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    if (payload.iat && user.updatedAt.getTime() > payload.iat * 1000) {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    this.assertStrongPassword(dto.newPassword, user.platformRole);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.authRepository.updatePasswordHash(user.id, passwordHash);
    await this.authRepository.revokeRefreshTokensForUser(user.id);

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'PASSWORD_RESET',
      result: 'SUCCESS',
    });

    return {
      message: 'Password reset successfully',
      data: null,
    };
  }

  async changePassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string },
  ) {
    const user = await this.authRepository.findUserWithPasswordById(userId);
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.assertStrongPassword(dto.newPassword, user.platformRole);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.authRepository.updatePasswordHash(user.id, passwordHash);
    await this.authRepository.revokeRefreshTokensForUser(user.id);

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'PASSWORD_CHANGE',
      result: 'SUCCESS',
    });

    return {
      message: 'Password changed successfully',
      data: null,
    };
  }

  async sendStepUpOtp(userId: string, purpose: StepUpPurpose) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive || !user.phone) {
      return this.genericOtpResponse();
    }

    await this.assertOtpNotLocked(user.phone, purpose);
    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    await this.authRepository.invalidateUnverifiedOtps(user.phone, purpose);
    await this.authRepository.createOtp({
      target: user.phone,
      otp: otpHash,
      purpose,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      userId: user.id,
    });

    return this.genericOtpResponse(otp);
  }

  async verifyStepUpOtp(
    userId: string,
    dto: { purpose: StepUpPurpose; otp: string },
  ) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive || !user.phone) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.assertOtpNotLocked(user.phone, dto.purpose);
    const record = await this.authRepository.findLatestOtp(
      user.phone,
      dto.purpose,
    );
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('OTP not found or expired');
    }

    const isMatch = await bcrypt.compare(dto.otp, record.otp);
    if (!isMatch) {
      await this.authRepository.incrementOtpAttempts(record.id);
      throw new BadRequestException('Invalid OTP');
    }

    await this.authRepository.markOtpVerified(record.id);
    const stepUpToken = this.signStepUpToken(user.id, dto.purpose);

    return {
      message: 'Step-up verification successful',
      data: { stepUpToken, expiresInSeconds: 5 * 60 },
    };
  }

  verifyStepUpToken(userId: string, purpose: StepUpPurpose, token: string) {
    let payload: StepUpJwtPayload;
    try {
      payload = this.jwtService.verify<StepUpJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired step-up token');
    }

    if (payload.userId !== userId || payload.purpose !== purpose) {
      throw new UnauthorizedException('Invalid or expired step-up token');
    }
  }

  async googleAuth(dto: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }) {
    const existingByGoogle = await this.authRepository.findUserByGoogleId(
      dto.googleId,
    );

    if (existingByGoogle) {
      return this.generateTokens(
        existingByGoogle.id,
        existingByGoogle.platformRole,
      );
    }

    const existingByEmail = await this.authRepository.findUserByEmail(
      dto.email,
    );
    if (existingByEmail) {
      throw new ConflictException(
        'Email already registered with different method',
      );
    }

    const user = await this.authRepository.createUser({
      name: dto.name,
      email: dto.email,
      googleId: dto.googleId,
      avatarUrl: dto.avatarUrl,
      provider: 'GOOGLE',
    });

    return this.generateTokens(user.id, user.platformRole);
  }

  async refresh(dto: { refreshToken: string }) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.authRepository.findRefreshToken(refreshTokenHash);
    if (!stored) {
      this.securityAudit.log({
        action: 'TOKEN_REFRESH',
        result: 'FAILURE',
        metadata: { reason: 'invalid' },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      this.securityAudit.log({
        actorUserId: stored.userId,
        action: 'TOKEN_REFRESH',
        result: 'FAILURE',
        metadata: { reason: 'expired' },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.rbacService.buildAuthSession(user.id);
    const accessToken = this.signAccessToken(user.id, user.platformRole);
    const refreshToken = uuid();
    await this.authRepository.rotateRefreshToken(stored.id, {
      userId: user.id,
      token: this.hashToken(refreshToken),
      expiresAt: this.getRefreshTokenExpiry(),
    });

    return {
      message: 'Authentication successful',
      data: { accessToken, refreshToken, session },
    };
  }

  async getSession(user: AuthenticatedUser) {
    const session = await this.rbacService.buildAuthSession(user.userId, {
      isImpersonating: user.isImpersonation ?? false,
    });
    return {
      message: 'Session fetched successfully',
      data: session,
    };
  }

  async logout(dto: { refreshToken: string }) {
    const stored = await this.authRepository.findRefreshToken(
      this.hashToken(dto.refreshToken),
    );
    if (!stored) {
      return { message: 'Logged out successfully', data: null };
    }

    await this.authRepository.revokeRefreshToken(stored.id);
    this.securityAudit.log({
      actorUserId: stored.userId,
      action: 'LOGOUT',
      result: 'SUCCESS',
    });
    return { message: 'Logged out successfully', data: null };
  }

  async listContexts(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token');
    }

    const context = await this.rbacService.resolveRequestContext(
      user.id,
      user.platformRole,
    );

    return {
      message: 'Context fetched successfully',
      data: context ? [context] : [],
    };
  }

  private assertExactlyOneContact(
    email: string | undefined,
    phone: string | undefined,
  ) {
    const hasEmail = Boolean(email);
    const hasPhone = Boolean(phone);
    if (hasEmail === hasPhone) {
      throw new BadRequestException('Provide exactly one of email or phone');
    }
  }

  private normalizeOptional(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private async assertOtpNotLocked(phone: string, purpose: string) {
    const failures = await this.authRepository.countRecentOtpFailures(
      phone,
      purpose,
      OTP_LOCKOUT_WINDOW_MS,
    );
    if (failures >= OTP_MAX_FAILURES) {
      this.securityAudit.log({
        action: 'OTP_LOCKOUT',
        result: 'FAILURE',
        metadata: { phone, purpose, failures },
      });
      throw new BadRequestException('Too many OTP attempts. Try again later.');
    }
  }

  private genericOtpResponse(otp?: string) {
    const exposeOtp = this.config.get<string>('AUTH_EXPOSE_OTP_IN_RESPONSE');
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const shouldExpose =
      nodeEnv !== 'production' &&
      (exposeOtp === 'true' || exposeOtp === '1' || exposeOtp === 'yes');

    return {
      message: 'OTP sent successfully',
      data: shouldExpose && otp ? { otp } : null,
    };
  }

  private assertStrongPassword(password: string, platformRole: PlatformRole) {
    if (platformRole === PlatformRole.CUSTOMER) {
      if (password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }
      return;
    }

    const strong =
      password.length >= 12 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password);

    if (!strong) {
      throw new BadRequestException(
        'Dashboard password must be at least 12 characters and include upper, lower, number, and symbol',
      );
    }
  }

  private async authenticateWithPassword(input: {
    email?: string;
    phone?: string;
    password: string;
  }) {
    const user = input.email
      ? await this.authRepository.findUserByEmail(input.email)
      : input.phone
        ? await this.authRepository.findUserByPhone(input.phone)
        : null;

    if (!user || !user.isActive || !user.passwordHash) {
      this.securityAudit.log({
        action: 'LOGIN',
        result: 'FAILURE',
        metadata: {
          email: input.email,
          phone: input.phone,
          reason: 'invalid_credentials',
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      this.securityAudit.log({
        actorUserId: user.id,
        actorRole: user.platformRole,
        action: 'LOGIN',
        result: 'FAILURE',
        metadata: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  private async generateTokens(userId: string, platformRole: PlatformRole) {
    const session = await this.rbacService.buildAuthSession(userId);
    const accessToken = this.signAccessToken(userId, platformRole);
    const refreshToken = uuid();

    await this.authRepository.createRefreshToken({
      userId,
      token: this.hashToken(refreshToken),
      expiresAt: this.getRefreshTokenExpiry(),
    });

    return {
      message: 'Authentication successful',
      data: {
        accessToken,
        refreshToken,
        session,
      },
    };
  }

  private signAccessToken(userId: string, platformRole: PlatformRole) {
    const payload: JwtPayload = {
      userId,
      platformRole,
    };

    return this.jwtService.sign(payload, {
      expiresIn: this.config.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private signStepUpToken(userId: string, purpose: StepUpPurpose) {
    const payload: StepUpJwtPayload = { userId, purpose };
    return this.jwtService.sign(payload, {
      expiresIn: STEP_UP_EXPIRES_IN,
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiry() {
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
}
