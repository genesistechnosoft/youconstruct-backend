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

    if (dto.email) {
      const existingEmail = await this.authRepository.findUserByEmail(
        dto.email,
      );
      if (existingEmail) {
        throw new ConflictException('Email already registered');
      }
    }

    if (dto.phone) {
      const existingPhone = await this.authRepository.findUserByPhone(
        dto.phone,
      );
      if (existingPhone) {
        throw new ConflictException('Phone already registered');
      }
    }

    let passwordHash: string | undefined;
    if (dto.password) {
      this.assertStrongPassword(dto.password, platformRole);
      passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const user = await this.authRepository.createUser({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
      platformRole,
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

  async login(dto: { email: string; password: string }) {
    const user = await this.authenticateWithPassword(dto.email, dto.password);

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
    const user = await this.authenticateWithPassword(dto.email, dto.password);

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

    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.authRepository.invalidateUnverifiedOtps(dto.phone, dto.purpose);
    await this.authRepository.createOtp({
      target: dto.phone,
      otp: otpHash,
      purpose: dto.purpose,
      expiresAt,
    });

    // TODO: inject Twilio client and send OTP without logging secret values.
    return { message: 'OTP sent successfully', data: null };
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
    if (existingUser && !existingUser.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user =
      existingUser ??
      (await this.authRepository.createUser({
        name: dto.phone,
        phone: dto.phone,
        provider: 'PHONE',
      }));

    await this.authRepository.markPhoneVerified(user.id);

    this.securityAudit.log({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: 'OTP_VERIFY',
      result: 'SUCCESS',
    });

    return this.generateTokens(user.id, user.platformRole);
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

  private async authenticateWithPassword(email: string, password: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user || !user.isActive || !user.passwordHash) {
      this.securityAudit.log({
        action: 'LOGIN',
        result: 'FAILURE',
        metadata: { email, reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
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

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiry() {
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
}
