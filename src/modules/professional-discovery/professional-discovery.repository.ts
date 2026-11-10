import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProfessionalContentStatus,
  ProfessionalOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DiscoverProfessionalsDto,
  DiscoverProjectsDto,
} from './dto/discovery-query.dto';

/** Public-safe professional profile select — NO PII (no phone/email/userId) */
const PUBLIC_PROFILE_SELECT = {
  id: true,
  displayName: true,
  slug: true,
  tagline: true,
  bio: true,
  city: true,
  state: true,
  experienceYears: true,
  websiteUrl: true,
  instagramUrl: true,
  approvedAt: true,
  categories: {
    select: {
      category: {
        select: { id: true, name: true, slug: true },
      },
    },
  },
} as const;

/** Public-safe project select — NO internal review metadata */
const PUBLIC_PROJECT_SELECT = {
  id: true,
  professionalId: true,
  title: true,
  description: true,
  location: true,
  areaSqft: true,
  budgetRange: true,
  completionYear: true,
  approvedAt: true,
} as const;

@Injectable()
export class ProfessionalDiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findApprovedProfessionals(filters: DiscoverProfessionalsDto) {
    const { skip, take } = paginate(filters.page, filters.limit);

    const where: Prisma.ProfessionalProfileWhereInput = {
      onboardingStatus: ProfessionalOnboardingStatus.APPROVED,
      deletedAt: null,
      ...(filters.search && {
        displayName: { contains: filters.search, mode: 'insensitive' },
      }),
      ...(filters.categorySlug && {
        categories: {
          some: {
            category: {
              slug: filters.categorySlug,
              isActive: true,
              deletedAt: null,
            },
          },
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.professionalProfile.findMany({
        where,
        select: PUBLIC_PROFILE_SELECT,
        orderBy: { approvedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.professionalProfile.count({ where }),
    ]);

    return { items, total };
  }

  findApprovedProfileBySlug(slug: string) {
    return this.prisma.professionalProfile.findFirst({
      where: {
        slug,
        onboardingStatus: ProfessionalOnboardingStatus.APPROVED,
        deletedAt: null,
      },
      select: PUBLIC_PROFILE_SELECT,
    });
  }

  async findApprovedProjectsForProfile(
    professionalId: string,
    filters: DiscoverProjectsDto,
  ) {
    const { skip, take } = paginate(filters.page, filters.limit);

    const where: Prisma.ProfessionalProjectWhereInput = {
      professionalId,
      status: ProfessionalContentStatus.APPROVED,
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      this.prisma.professionalProject.findMany({
        where,
        select: PUBLIC_PROJECT_SELECT,
        orderBy: { approvedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.professionalProject.count({ where }),
    ]);

    return { items, total };
  }
}
