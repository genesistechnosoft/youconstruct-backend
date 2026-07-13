import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { UserRole } from '../../common/decorators/roles.decorator';
import { AuthRepository } from './auth.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: {
    name: string;
    email?: string;
    phone?: string;
    password?: string;
  }) {
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
      passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const user = await this.authRepository.createUser({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
      role: UserRole.CUSTOMER,
    });

    return this.generateTokens(user.id, user.role);
  }

  async login(dto: { email: string; password: string }) {
    const user = await this.authRepository.findUserByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user.id, user.role);
  }

  async sendOtp(dto: { phone: string; purpose: string }) {
    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

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

    if (record.attempts >= 3) {
      throw new BadRequestException('Too many attempts');
    }

    const isMatch = await bcrypt.compare(dto.otp, record.otp);
    if (!isMatch) {
      await this.authRepository.incrementOtpAttempts(record.id);
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

    return this.generateTokens(user.id, user.role);
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
      return this.generateTokens(existingByGoogle.id, existingByGoogle.role);
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

    return this.generateTokens(user.id, user.role);
  }

  async refresh(dto: { refreshToken: string }) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.authRepository.findRefreshToken(refreshTokenHash);
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = this.signAccessToken(user.id, user.role);
    const refreshToken = uuid();
    await this.authRepository.rotateRefreshToken(stored.id, {
      userId: user.id,
      token: this.hashToken(refreshToken),
      expiresAt: this.getRefreshTokenExpiry(),
    });

    return {
      message: 'Authentication successful',
      data: { accessToken, refreshToken },
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
    return { message: 'Logged out successfully', data: null };
  }

  private async generateTokens(userId: string, role: string) {
    const accessToken = this.signAccessToken(userId, role);
    const refreshToken = uuid();

    await this.authRepository.createRefreshToken({
      userId,
      token: this.hashToken(refreshToken),
      expiresAt: this.getRefreshTokenExpiry(),
    });

    return {
      message: 'Authentication successful',
      data: { accessToken, refreshToken },
    };
  }

  private signAccessToken(userId: string, role: string) {
    return this.jwtService.sign(
      { userId, role },
      {
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as JwtSignOptions['expiresIn'],
      },
    );
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiry() {
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
}
