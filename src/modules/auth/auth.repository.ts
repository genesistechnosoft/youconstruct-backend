import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../../../generated/prisma/client.js';
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

  async createUser(data: {
    name: string;
    email?: string;
    phone?: string;
    passwordHash?: string;
    role?: UserRole;
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
            role: true,
            provider: true,
          },
        });

        if (user.role === UserRole.VENDOR) {
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
