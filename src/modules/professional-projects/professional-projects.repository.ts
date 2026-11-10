import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProfessionalContentStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PROFESSIONAL_CONTENT_TRANSITIONS } from '../professionals/professional-status.util';
import { ProjectFiltersDto } from './dto/project-filters.dto';

const PROJECT_SELECT = {
  id: true,
  professionalId: true,
  title: true,
  description: true,
  location: true,
  areaSqft: true,
  budgetRange: true,
  completionYear: true,
  status: true,
  rejectionReason: true,
  removalReason: true,
  submittedAt: true,
  reviewedAt: true,
  approvedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const ADMIN_PROJECT_SELECT = {
  ...PROJECT_SELECT,
  professional: {
    select: {
      id: true,
      displayName: true,
      slug: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  },
} as const;

@Injectable()
export class ProfessionalProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.professionalProject.findFirst({
      where: { id, deletedAt: null },
      select: PROJECT_SELECT,
    });
  }

  findByIdForAdmin(id: string) {
    return this.prisma.professionalProject.findFirst({
      where: { id, deletedAt: null },
      select: ADMIN_PROJECT_SELECT,
    });
  }

  findByIdAndOwner(id: string, professionalId: string) {
    return this.prisma.professionalProject.findFirst({
      where: { id, professionalId, deletedAt: null },
      select: PROJECT_SELECT,
    });
  }

  async findForProfessional(
    professionalId: string,
    filters: ProjectFiltersDto,
  ) {
    const { skip, take } = paginate(filters.page, filters.limit);

    const where: Prisma.ProfessionalProjectWhereInput = {
      professionalId,
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        title: { contains: filters.search, mode: 'insensitive' },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.professionalProject.findMany({
        where,
        select: PROJECT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.professionalProject.count({ where }),
    ]);

    return { items, total };
  }

  async findForAdmin(filters: ProjectFiltersDto) {
    const { skip, take } = paginate(filters.page, filters.limit);

    const where: Prisma.ProfessionalProjectWhereInput = {
      deletedAt: null,
      ...(filters.status && { status: filters.status }),
      ...(filters.search && {
        title: { contains: filters.search, mode: 'insensitive' },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.professionalProject.findMany({
        where,
        select: ADMIN_PROJECT_SELECT,
        orderBy: { submittedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.professionalProject.count({ where }),
    ]);

    return { items, total };
  }

  countNonDeleted(professionalId: string) {
    return this.prisma.professionalProject.count({
      where: { professionalId, deletedAt: null },
    });
  }

  create(professionalId: string, data: Prisma.ProfessionalProjectCreateInput) {
    return this.prisma.professionalProject.create({
      data: {
        ...data,
        professional: { connect: { id: professionalId } },
      },
      select: PROJECT_SELECT,
    });
  }

  update(id: string, data: Prisma.ProfessionalProjectUpdateInput) {
    return this.prisma.professionalProject.update({
      where: { id },
      data,
      select: PROJECT_SELECT,
    });
  }

  softDelete(id: string) {
    return this.prisma.professionalProject.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  /**
   * Compare-and-set status transition.
   * Uses `updateMany` with `where: { id, status: { in: allowedFrom } }`.
   * count === 0 means the project was not in an allowed state → ConflictException.
   * REMOVED is terminal: it has no allowed transitions and can never be left.
   */
  async updateWithTransition(
    id: string,
    toStatus: ProfessionalContentStatus,
    extraData: Prisma.ProfessionalProjectUpdateInput = {},
  ) {
    const allowedFrom = Object.entries(PROFESSIONAL_CONTENT_TRANSITIONS)
      .filter(([, targets]) => targets.includes(toStatus))
      .map(([from]) => from as ProfessionalContentStatus);

    if (allowedFrom.length === 0) {
      throw new ConflictException(`No transitions lead to status ${toStatus}`);
    }

    const { count } = await this.prisma.professionalProject.updateMany({
      where: {
        id,
        deletedAt: null,
        status: { in: allowedFrom },
      },
      data: {
        status: toStatus,
        ...extraData,
      },
    });

    if (count === 0) {
      // Could be not-found or wrong current status — load to distinguish
      const project = await this.findById(id);
      if (!project) throw new NotFoundException('Project not found');
      throw new ConflictException(
        `Cannot transition project from ${project.status} to ${toStatus}`,
      );
    }

    return this.prisma.professionalProject.findFirst({
      where: { id },
      select: PROJECT_SELECT,
    });
  }

  approve(id: string) {
    return this.updateWithTransition(id, ProfessionalContentStatus.APPROVED, {
      approvedAt: new Date(),
      reviewedAt: new Date(),
      rejectionReason: null,
    });
  }

  reject(id: string, rejectionReason: string) {
    return this.updateWithTransition(id, ProfessionalContentStatus.REJECTED, {
      rejectionReason,
      reviewedAt: new Date(),
    });
  }

  remove(id: string, removalReason: string) {
    return this.updateWithTransition(id, ProfessionalContentStatus.REMOVED, {
      removalReason,
      removedAt: new Date(),
    });
  }
}
