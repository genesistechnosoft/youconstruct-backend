import { Injectable } from '@nestjs/common';
import {
  PermissionScope,
  Prisma,
  ProfessionalOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacRepository } from '../rbac/rbac.repository';
import { ProfessionalFiltersDto } from './dto/professional-filters.dto';

const PROFILE_SELECT = {
  id: true,
  userId: true,
  displayName: true,
  slug: true,
  tagline: true,
  bio: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  experienceYears: true,
  websiteUrl: true,
  instagramUrl: true,
  onboardingStatus: true,
  isApproved: true,
  submittedAt: true,
  reviewedAt: true,
  approvedAt: true,
  rejectionReason: true,
  suspendedAt: true,
  suspensionReason: true,
  createdAt: true,
  updatedAt: true,
  categories: {
    select: {
      category: {
        select: { id: true, name: true, slug: true },
      },
    },
  },
} as const;

const ADMIN_LIST_SELECT = {
  id: true,
  userId: true,
  displayName: true,
  slug: true,
  city: true,
  state: true,
  onboardingStatus: true,
  isApproved: true,
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
    },
  },
} as const;

@Injectable()
export class ProfessionalsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacRepository: RbacRepository,
  ) {}

  findByUserId(userId: string) {
    return this.prisma.professionalProfile.findFirst({
      where: { userId, deletedAt: null },
      select: PROFILE_SELECT,
    });
  }

  /** Used by post-approval routes to load a profile by its id (from activeContext). */
  findApprovedById(id: string) {
    return this.prisma.professionalProfile.findFirst({
      where: {
        id,
        deletedAt: null,
        onboardingStatus: ProfessionalOnboardingStatus.APPROVED,
      },
      select: PROFILE_SELECT,
    });
  }

  /** Lightweight lookup for getting the userId of a profile owner. */
  findByIdForUserId(id: string) {
    return this.prisma.professionalProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  findById(id: string) {
    return this.prisma.professionalProfile.findFirst({
      where: { id, deletedAt: null },
      select: PROFILE_SELECT,
    });
  }

  findByIdForAdmin(id: string) {
    return this.prisma.professionalProfile.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...PROFILE_SELECT,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            platformRole: true,
            isEmailVerified: true,
            isPhoneVerified: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async findProfessionals(filters: ProfessionalFiltersDto) {
    const { skip, take } = paginate(filters.page, filters.limit);

    const where: Prisma.ProfessionalProfileWhereInput = {
      deletedAt: null,
      ...(filters.status && { onboardingStatus: filters.status }),
      ...(filters.search && {
        OR: [
          { displayName: { contains: filters.search, mode: 'insensitive' } },
          {
            user: {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.professionalProfile.findMany({
        where,
        select: ADMIN_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.professionalProfile.count({ where }),
    ]);

    return { items, total };
  }

  async createProfile(userId: string, slug: string) {
    return this.prisma.professionalProfile.create({
      data: {
        userId,
        slug,
        displayName: '',
        onboardingStatus: ProfessionalOnboardingStatus.DRAFT,
        isApproved: false,
      },
      select: PROFILE_SELECT,
    });
  }

  async updateProfile(id: string, data: Prisma.ProfessionalProfileUpdateInput) {
    return this.prisma.professionalProfile.update({
      where: { id },
      data,
      select: PROFILE_SELECT,
    });
  }

  async syncCategories(professionalId: string, categoryIds: string[]) {
    // Replace all category links in a transaction
    await this.prisma.$transaction([
      this.prisma.professionalProfileCategory.deleteMany({
        where: { professionalId },
      }),
      ...(categoryIds.length > 0
        ? [
            this.prisma.professionalProfileCategory.createMany({
              data: categoryIds.map((categoryId) => ({
                professionalId,
                categoryId,
              })),
            }),
          ]
        : []),
    ]);
  }

  async countCategoriesForProfile(professionalId: string) {
    return this.prisma.professionalProfileCategory.count({
      where: { professionalId },
    });
  }

  async approveProfile(id: string, userId: string) {
    // Atomically update profile status AND set up Owner RBAC in one transaction.
    // If ensureOwnerRole fails, the profile update is rolled back.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.professionalProfile.update({
        where: { id },
        data: {
          onboardingStatus: ProfessionalOnboardingStatus.APPROVED,
          isApproved: true,
          approvedAt: new Date(),
          reviewedAt: new Date(),
          rejectionReason: null,
        },
        select: PROFILE_SELECT,
      });

      // Create Owner role + assign all PROFESSIONAL permissions + TeamMember row
      await this.rbacRepository.ensureOwnerRole(
        {
          scope: PermissionScope.PROFESSIONAL,
          scopeEntityId: id,
          userId,
        },
        tx,
      );

      return updated;
    });
  }

  async rejectProfile(id: string, rejectionReason: string) {
    return this.prisma.professionalProfile.update({
      where: { id },
      data: {
        onboardingStatus: ProfessionalOnboardingStatus.REJECTED,
        rejectionReason,
        reviewedAt: new Date(),
      },
      select: PROFILE_SELECT,
    });
  }

  async suspendProfile(id: string, suspensionReason: string) {
    return this.prisma.professionalProfile.update({
      where: { id },
      data: {
        onboardingStatus: ProfessionalOnboardingStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason,
      },
      select: PROFILE_SELECT,
    });
  }

  async reinstateProfile(id: string) {
    return this.prisma.professionalProfile.update({
      where: { id },
      data: {
        onboardingStatus: ProfessionalOnboardingStatus.APPROVED,
        suspendedAt: null,
        suspensionReason: null,
      },
      select: PROFILE_SELECT,
    });
  }

  async submitProfile(id: string) {
    return this.prisma.professionalProfile.update({
      where: { id },
      data: {
        onboardingStatus: ProfessionalOnboardingStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      select: PROFILE_SELECT,
    });
  }

  slugExists(slug: string, excludeId?: string) {
    return this.prisma.professionalProfile.findFirst({
      where: {
        slug,
        deletedAt: null,
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
  }
}
