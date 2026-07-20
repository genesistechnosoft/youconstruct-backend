import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformRole, Prisma } from '../../../generated/prisma/client.js';
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
        platformRole: true,
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
        platformRole: true,
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
        platformRole: true,
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
        platformRole: true,
        isActive: true,
        provider: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        avatarUrl: true,
        fcmToken: true,
      },
    });
  }

  async createUser(data: {
    name: string;
    email?: string;
    phone?: string;
    passwordHash?: string;
    platformRole?: PlatformRole;
    provider?: string;
    googleId?: string;
    avatarUrl?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: data as Prisma.UserCreateInput,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            platformRole: true,
            provider: true,
          },
        });

        if (user.platformRole === PlatformRole.VENDOR) {
          await tx.vendorProfile.create({
            data: {
              userId: user.id,
              businessName: user.name,
            },
            select: { id: true },
          });
        }

        return user;
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  createRefreshToken(data: {
    userId: string;
    token: string;
    expiresAt: Date;
    deviceInfo?: string;
    ipAddress?: string;
  }) {
    return this.prisma.refreshToken.create({
      data,
      select: { id: true, userId: true, expiresAt: true },
    });
  }

  findRefreshToken(token: string) {
    return this.prisma.refreshToken.findFirst({
      where: { token, revokedAt: null },
      select: { id: true, userId: true, expiresAt: true },
    });
  }

  revokeRefreshToken(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true },
    });
  }

  rotateRefreshToken(
    currentTokenId: string,
    nextToken: {
      userId: string;
      token: string;
      expiresAt: Date;
      deviceInfo?: string;
      ipAddress?: string;
    },
  ) {
    return this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: currentTokenId },
        data: { revokedAt: new Date() },
        select: { id: true },
      }),
      this.prisma.refreshToken.create({
        data: nextToken,
        select: { id: true },
      }),
    ]);
  }

  markPhoneVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isPhoneVerified: true },
      select: { id: true },
    });
  }

  createOtp(data: {
    target: string;
    otp: string;
    purpose: string;
    expiresAt: Date;
    userId?: string;
  }) {
    return this.prisma.otpVerification.create({
      data,
      select: { id: true },
    });
  }

  findLatestOtp(target: string, purpose: string) {
    return this.prisma.otpVerification.findFirst({
      where: { target, purpose, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        otp: true,
        expiresAt: true,
        attempts: true,
      },
    });
  }

  /**
   * Sum failed attempts across recent unverified OTP rows for lockout
   * that cannot be reset by requesting a new OTP.
   */
  async countRecentOtpFailures(
    target: string,
    purpose: string,
    windowMs = 15 * 60 * 1000,
  ) {
    const since = new Date(Date.now() - windowMs);
    const rows = await this.prisma.otpVerification.findMany({
      where: {
        target,
        purpose,
        createdAt: { gte: since },
      },
      select: { attempts: true },
    });

    return rows.reduce((sum, row) => sum + row.attempts, 0);
  }

  invalidateUnverifiedOtps(target: string, purpose: string) {
    return this.prisma.otpVerification.updateMany({
      where: { target, purpose, verifiedAt: null },
      data: { expiresAt: new Date(0) },
    });
  }

  markOtpVerified(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { verifiedAt: new Date() },
      select: { id: true },
    });
  }

  incrementOtpAttempts(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { id: true },
    });
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('User already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('User not found');
    }

    throw error;
  }
}
