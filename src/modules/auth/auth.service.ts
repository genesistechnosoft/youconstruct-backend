import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
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
    role?: string;
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
      role: dto.role,
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
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.authRepository.createOtp({
      target: dto.phone,
      otp,
      purpose: dto.purpose,
      expiresAt,
    });

    // TODO: inject Twilio client where SMS sending would happen
    console.log(`OTP for ${dto.phone}: ${otp}`);

    return { message: 'OTP sent successfully' };
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

    if (record.otp !== dto.otp) {
      await this.authRepository.incrementOtpAttempts(record.id);
      throw new BadRequestException('Invalid OTP');
    }

    await this.authRepository.markOtpVerified(record.id);

    const existingUser = await this.authRepository.findUserByPhone(dto.phone);
    const user =
      existingUser ??
      (await this.authRepository.createUser({
        name: dto.phone,
        phone: dto.phone,
        provider: 'PHONE',
      }));

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
    const stored = await this.authRepository.findRefreshToken(dto.refreshToken);
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokens(user.id, user.role);
  }

  async logout(dto: { refreshToken: string }) {
    const stored = await this.authRepository.findRefreshToken(dto.refreshToken);
    if (!stored) {
      return { message: 'Logged out successfully' };
    }

    await this.authRepository.revokeRefreshToken(stored.id);
    return { message: 'Logged out successfully' };
  }

  private async generateTokens(userId: string, role: string) {
    const accessToken = this.jwtService.sign(
      { userId, role },
      {
        expiresIn: this.config.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as JwtSignOptions['expiresIn'],
      },
    );
    const refreshToken = uuid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.authRepository.createRefreshToken({
      userId,
      token: refreshToken,
      expiresAt,
    });

    return {
      message: 'Authentication successful',
      data: { accessToken, refreshToken },
    };
  }
}
