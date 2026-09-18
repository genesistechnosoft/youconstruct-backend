import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CommerceOtpRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    target: string;
    otp: string;
    purpose: string;
    expiresAt: Date;
    userId?: string;
    referenceType?: string;
    referenceId?: string;
  }) {
    return this.prisma.otpVerification.create({
      data,
      select: { id: true },
    });
  }

  findLatest(input: {
    purpose: string;
    referenceType: string;
    referenceId: string;
  }) {
    return this.prisma.otpVerification.findFirst({
      where: {
        purpose: input.purpose,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        otp: true,
        expiresAt: true,
        attempts: true,
        target: true,
      },
    });
  }

  invalidateUnverified(input: {
    purpose: string;
    referenceType: string;
    referenceId: string;
  }) {
    return this.prisma.otpVerification.updateMany({
      where: {
        purpose: input.purpose,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        verifiedAt: null,
      },
      data: { expiresAt: new Date(0) },
    });
  }

  markVerified(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { verifiedAt: new Date() },
      select: { id: true },
    });
  }

  incrementAttempts(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { id: true, attempts: true },
    });
  }
}
