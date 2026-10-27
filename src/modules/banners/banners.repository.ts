import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const BANNER_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  targetUrl: true,
  sortOrder: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class BannersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPublicActive(now: Date) {
    return this.prisma.homepageBanner.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { sortOrder: 'asc' },
      select: BANNER_SELECT,
    });
  }

  findAllAdmin(skip?: number, take?: number) {
    return this.prisma.homepageBanner.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      skip,
      take,
      select: BANNER_SELECT,
    });
  }

  countAllAdmin() {
    return this.prisma.homepageBanner.count({
      where: { deletedAt: null },
    });
  }

  findById(id: string) {
    return this.prisma.homepageBanner.findFirst({
      where: { id, deletedAt: null },
      select: BANNER_SELECT,
    });
  }

  async findNextSortOrder() {
    const result = await this.prisma.homepageBanner.aggregate({
      where: { deletedAt: null },
      _max: { sortOrder: true },
    });

    return (result._max.sortOrder ?? -1) + 1;
  }

  async create(data: Prisma.HomepageBannerCreateInput) {
    try {
      return await this.prisma.homepageBanner.create({
        data,
        select: BANNER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.HomepageBannerUpdateInput) {
    try {
      return await this.prisma.homepageBanner.update({
        where: { id },
        data,
        select: BANNER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAllIds() {
    return this.prisma.homepageBanner.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
  }

  async reorder(orderedIds: string[]) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await Promise.all(
          orderedIds.map((id, index) =>
            tx.homepageBanner.update({
              where: { id },
              data: { sortOrder: index },
              select: { id: true },
            }),
          ),
        );

        return tx.homepageBanner.findMany({
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: BANNER_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDelete(id: string) {
    try {
      return await this.prisma.homepageBanner.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
        select: BANNER_SELECT,
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
      throw new ConflictException('Banner conflict');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Banner not found');
    }

    throw error;
  }
}
