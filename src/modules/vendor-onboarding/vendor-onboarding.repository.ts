import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KycDocumentType,
  KycStatus,
  PermissionScope,
  Prisma,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacRepository } from '../rbac/rbac.repository';
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
  slug: true,
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
  about: true,
  onboardingStatus: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VENDOR_LIST_SELECT = {
  id: true,
  userId: true,
  businessName: true,
  slug: true,
  city: true,
  state: true,
  gstNumber: true,
  isApproved: true,
  onboardingStatus: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      kycDocuments: {
        orderBy: { documentType: Prisma.SortOrder.asc },
        select: {
          documentType: true,
          status: true,
        },
      },
    },
  },
  membership: {
    select: {
      plan: true,
      isActive: true,
    },
  },
} as const;

const VENDOR_REVIEW_SELECT = {
  ...VENDOR_PROFILE_SELECT,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      platformRole: true,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacRepository: RbacRepository,
  ) {}

  findUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, platformRole: true },
    });
  }

  async hasTeamMembership(userId: string) {
    const slot = await this.rbacRepository.findMembershipSlot(userId);
    return slot !== null;
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

  createDraftVendorProfile(userId: string, businessName: string, slug: string) {
    return this.prisma.vendorProfile.create({
      data: { userId, businessName, slug },
      select: VENDOR_REVIEW_SELECT,
    });
  }

  findBySlug(slug: string, excludeId?: string) {
    return this.prisma.vendorProfile.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  findByGstNumber(gstNumber: string, excludeId?: string) {
    return this.prisma.vendorProfile.findFirst({
      where: {
        gstNumber: { equals: gstNumber, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  async findVendors(filters: VendorFiltersDto) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const search = filters.search?.trim();
    const where: Prisma.VendorProfileWhereInput = {
      deletedAt: null,
      ...(filters.status && { onboardingStatus: filters.status }),
      ...(search && {
        OR: [
          { businessName: { contains: search, mode: 'insensitive' } },
          { gstNumber: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { phone: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        skip,
        take,
        select: VENDOR_LIST_SELECT,
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

  findKycDocument(userId: string, documentType: KycDocumentType) {
    return this.prisma.kycDocument.findUnique({
      where: { userId_documentType: { userId, documentType } },
      select: KYC_DOCUMENT_SELECT,
    });
  }

  async updateKycDocumentStatus(
    userId: string,
    documentType: KycDocumentType,
    data: {
      status: KycStatus;
      rejectionNote?: string | null;
    },
  ) {
    try {
      return await this.prisma.kycDocument.update({
        where: { userId_documentType: { userId, documentType } },
        data: {
          status: data.status,
          rejectionNote: data.rejectionNote,
        },
        select: KYC_DOCUMENT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
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

  async approveVendor(
    id: string,
    userId: string,
    requiredDocs: KycDocumentType[],
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const reviewedAt = new Date();
        const existing = await tx.vendorProfile.findUniqueOrThrow({
          where: { id },
          select: { submittedAt: true },
        });

        if (requiredDocs.length > 0) {
          await tx.kycDocument.updateMany({
            where: {
              userId,
              documentType: { in: requiredDocs },
            },
            data: {
              status: KycStatus.VERIFIED,
              rejectionNote: null,
            },
          });
        }

        await tx.vendorProfile.update({
          where: { id },
          data: {
            isApproved: true,
            approvedAt: reviewedAt,
            onboardingStatus: VendorOnboardingStatus.APPROVED,
            reviewedAt,
            rejectionReason: null,
            submittedAt: existing.submittedAt ?? reviewedAt,
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

        const vendor = await tx.vendorProfile.findUniqueOrThrow({
          where: { id },
          select: { id: true, userId: true },
        });

        await this.rbacRepository.ensureOwnerRole(
          {
            scope: PermissionScope.VENDOR,
            scopeEntityId: vendor.id,
            userId: vendor.userId,
          },
          tx,
        );

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
