import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        passwordHash: true,
        isActive: true,
        isEmailVerified: true,
        provider: true,
      },
    });
  }

  findUserByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        passwordHash: true,
        isActive: true,
        isPhoneVerified: true,
        provider: true,
      },
    });
  }

  findUserByGoogleId(googleId: string) {
    return this.prisma.user.findFirst({
      where: { googleId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        provider: true,
      },
    });
  }

  findUserById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        provider: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        avatarUrl: true,
        fcmToken: true,
      },
    });
  }

  createUser(data: {
    name: string;
    email?: string;
    phone?: string;
    passwordHash?: string;
    role?: string;
    provider?: string;
    googleId?: string;
    avatarUrl?: string;
  }) {
    return this.prisma.user.create({
      data: data as Prisma.UserCreateInput,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        provider: true,
      },
    });
  }

  createRefreshToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    deviceInfo?: string;
    ipAddress?: string;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  findRefreshToken(token: string) {
    return this.prisma.refreshToken.findFirst({
      where: { token, revokedAt: null },
    });
  }

  revokeRefreshToken(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  createOtp(data: {
    target: string;
    otp: string;
    purpose: string;
    expiresAt: Date;
    userId?: string;
  }) {
    return this.prisma.otpVerification.create({ data });
  }

  findLatestOtp(target: string, purpose: string) {
    return this.prisma.otpVerification.findFirst({
      where: { target, purpose, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  markOtpVerified(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { verifiedAt: new Date() },
    });
  }

  incrementOtpAttempts(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }
}
