import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KycDocumentType,
  KycStatus,
  Prisma,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { VendorFiltersDto } from './dto/vendor-filters.dto';

const KYC_DOCUMENT_SELECT = {
  id: true,
  userId: true,
  mediaId: true,
  documentType: true,
  documentNo: true,
  fileUrl: true,
  status: true,
  rejectionNote: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VENDOR_PROFILE_SELECT = {
  id: true,
  userId: true,
  businessName: true,
  businessAddress: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  gstNumber: true,
  isApproved: true,
  approvedAt: true,
  bio: true,
  onboardingStatus: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VENDOR_REVIEW_SELECT = {
  ...VENDOR_PROFILE_SELECT,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      kycDocuments: {
        orderBy: { documentType: Prisma.SortOrder.asc },
        select: KYC_DOCUMENT_SELECT,
      },
    },
  },
  wallet: {
    select: {
      id: true,
      balance: true,
      lockedBalance: true,
      totalEarned: true,
      totalWithdrawn: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  membership: {
    select: {
      id: true,
      plan: true,
      startedAt: true,
      expiresAt: true,
      isActive: true,
      storageLimitMb: true,
      storageUsedMb: true,
      productLimit: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  storeSettings: {
    select: {
      id: true,
      vendorId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  bankAccount: {
    select: {
      id: true,
      accountHolderName: true,
      bankName: true,
      branchName: true,
      isVerified: true,
      verifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

@Injectable()
export class VendorOnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, role: true },
    });
  }

  findVendorByUserId(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: VENDOR_REVIEW_SELECT,
    });
  }

  findVendorById(id: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id, deletedAt: null },
      select: VENDOR_REVIEW_SELECT,
    });
  }

  createDraftVendorProfile(userId: string, businessName: string) {
    return this.prisma.vendorProfile.create({
      data: { userId, businessName },
      select: VENDOR_REVIEW_SELECT,
    });
  }

  async findVendors(filters: VendorFiltersDto) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.VendorProfileWhereInput = {
      deletedAt: null,
      ...(filters.status && { onboardingStatus: filters.status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        skip,
        take,
        select: VENDOR_REVIEW_SELECT,
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);

    return { items, total };
  }

  async updateProfile(id: string, data: Prisma.VendorProfileUpdateInput) {
    try {
      return await this.prisma.vendorProfile.update({
        where: { id },
        data,
        select: VENDOR_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async upsertKycDocument(
    userId: string,
    documentType: KycDocumentType,
    data: { fileUrl: string; documentNo?: string; mediaId?: string },
  ) {
    try {
      return await this.prisma.kycDocument.upsert({
        where: { userId_documentType: { userId, documentType } },
        update: {
          fileUrl: data.fileUrl,
          mediaId: data.mediaId,
          documentNo: data.documentNo,
          status: KycStatus.SUBMITTED,
          rejectionNote: null,
        },
        create: {
          userId,
          documentType,
          fileUrl: data.fileUrl,
          mediaId: data.mediaId,
          documentNo: data.documentNo,
          status: KycStatus.SUBMITTED,
        },
        select: KYC_DOCUMENT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findKycDocuments(userId: string) {
    return this.prisma.kycDocument.findMany({
      where: { userId },
      orderBy: { documentType: Prisma.SortOrder.asc },
      select: KYC_DOCUMENT_SELECT,
    });
  }

  async submitVendor(id: string) {
    try {
      return await this.prisma.vendorProfile.update({
        where: { id },
        data: {
          onboardingStatus: VendorOnboardingStatus.SUBMITTED,
          submittedAt: new Date(),
          reviewedAt: null,
          rejectionReason: null,
          isApproved: false,
          approvedAt: null,
        },
        select: VENDOR_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async approveVendor(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const reviewedAt = new Date();

        await tx.vendorProfile.update({
          where: { id },
          data: {
            isApproved: true,
            approvedAt: reviewedAt,
            onboardingStatus: VendorOnboardingStatus.APPROVED,
            reviewedAt,
            rejectionReason: null,
          },
          select: { id: true },
        });

        await tx.vendorWallet.upsert({
          where: { vendorId: id },
          update: {},
          create: { vendorId: id },
          select: { id: true },
        });

        await tx.vendorMembership.upsert({
          where: { vendorId: id },
          update: {},
          create: { vendorId: id },
          select: { id: true },
        });

        await tx.vendorStoreSettings.upsert({
          where: { vendorId: id },
          update: {},
          create: { vendorId: id },
          select: { id: true },
        });

        return tx.vendorProfile.findUniqueOrThrow({
          where: { id },
          select: VENDOR_REVIEW_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async rejectVendor(id: string, rejectionReason: string) {
    try {
      return await this.prisma.vendorProfile.update({
        where: { id },
        data: {
          isApproved: false,
          onboardingStatus: VendorOnboardingStatus.REJECTED,
          reviewedAt: new Date(),
          rejectionReason,
        },
        select: VENDOR_REVIEW_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Vendor onboarding record already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Vendor not found');
    }

    throw error;
  }
}
