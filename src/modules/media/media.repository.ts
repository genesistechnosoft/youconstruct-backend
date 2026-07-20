import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAccessLevel,
  MediaContext,
  MediaEntityType,
  MediaOwnerType,
  MediaProcessingJobStatus,
  MediaProcessingStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaFiltersDto } from './dto/media-filters.dto';
import { ReorderMediaLinkItemDto } from './dto/reorder-media-links.dto';

export const MEDIA_SELECT = {
  id: true,
  uploadedBy: true,
  ownerType: true,
  ownerId: true,
  folderId: true,
  fileName: true,
  originalName: true,
  fileType: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationSeconds: true,
  storageDriver: true,
  originalKey: true,
  optimizedKey: true,
  thumbnailKey: true,
  accessLevel: true,
  processingStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const MEDIA_LINK_SELECT = {
  id: true,
  mediaId: true,
  entityType: true,
  entityId: true,
  context: true,
  isPrimary: true,
  sortOrder: true,
  createdAt: true,
  media: {
    select: MEDIA_SELECT,
  },
} as const;

export const MEDIA_FOLDER_SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  name: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  findApprovedVendorByUserId(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, isApproved: true, deletedAt: null },
      select: { id: true, membership: { select: { id: true } } },
    });
  }

  findApprovedVendorById(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, isApproved: true, deletedAt: null },
      select: { id: true, membership: { select: { id: true } } },
    });
  }

  findUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, platformRole: true },
    });
  }

  async findManyMedia(
    ownerType: MediaOwnerType,
    ownerId: string,
    filters: MediaFiltersDto,
  ) {
    const { skip, take } = paginate(filters.page, filters.limit);
    const where: Prisma.MediaWhereInput = {
      ownerType,
      ownerId,
      deletedAt: null,
      // Store library never includes PRIVATE compliance/KYC docs
      accessLevel: {
        in: [MediaAccessLevel.PUBLIC, MediaAccessLevel.SIGNED],
      },
      kycDocuments: { none: {} },
      ...(filters.folderId && { folderId: filters.folderId }),
      ...(filters.fileType && { fileType: filters.fileType }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        select: MEDIA_SELECT,
      }),
      this.prisma.media.count({ where }),
    ]);

    return { items, total };
  }

  findMediaByOwner(id: string, ownerType: MediaOwnerType, ownerId: string) {
    return this.prisma.media.findFirst({
      where: { id, ownerType, ownerId, deletedAt: null },
      select: MEDIA_SELECT,
    });
  }

  findMediaByIds(
    ownerType: MediaOwnerType,
    ownerId: string,
    mediaIds: string[],
  ) {
    return this.prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        ownerType,
        ownerId,
        deletedAt: null,
      },
      select: MEDIA_SELECT,
    });
  }

  findMediaForProcessing(id: string) {
    return this.prisma.media.findFirst({
      where: { id, deletedAt: null },
      select: MEDIA_SELECT,
    });
  }

  async createMedia(data: Prisma.MediaUncheckedCreateInput) {
    try {
      return await this.prisma.media.create({
        data,
        select: MEDIA_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateMedia(id: string, data: Prisma.MediaUncheckedUpdateInput) {
    try {
      return await this.prisma.media.update({
        where: { id },
        data,
        select: MEDIA_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countActiveLinks(mediaId: string) {
    return this.prisma.mediaLink.count({
      where: { mediaId, deletedAt: null },
    });
  }

  async softDeleteMedia(id: string) {
    try {
      return await this.prisma.media.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: MEDIA_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  incrementVendorStorageUsed(vendorId: string, sizeBytes: number) {
    return this.prisma.vendorMembership.updateMany({
      where: { vendorId },
      data: { storageUsedMb: { increment: sizeBytes / (1024 * 1024) } },
    });
  }

  decrementVendorStorageUsed(vendorId: string, sizeBytes: number) {
    return this.prisma.vendorMembership.updateMany({
      where: { vendorId },
      data: { storageUsedMb: { decrement: sizeBytes / (1024 * 1024) } },
    });
  }

  listFolders(ownerType: MediaOwnerType, ownerId: string) {
    return this.prisma.mediaFolder.findMany({
      where: { ownerType, ownerId, deletedAt: null },
      orderBy: [
        { parentId: Prisma.SortOrder.asc },
        { name: Prisma.SortOrder.asc },
      ],
      select: MEDIA_FOLDER_SELECT,
    });
  }

  findFolderByOwner(id: string, ownerType: MediaOwnerType, ownerId: string) {
    return this.prisma.mediaFolder.findFirst({
      where: { id, ownerType, ownerId, deletedAt: null },
      select: MEDIA_FOLDER_SELECT,
    });
  }

  async createFolder(data: Prisma.MediaFolderUncheckedCreateInput) {
    try {
      return await this.prisma.mediaFolder.create({
        data,
        select: MEDIA_FOLDER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateFolder(id: string, data: Prisma.MediaFolderUncheckedUpdateInput) {
    try {
      return await this.prisma.mediaFolder.update({
        where: { id },
        data,
        select: MEDIA_FOLDER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countFolderMedia(folderId: string) {
    return this.prisma.media.count({
      where: { folderId, deletedAt: null },
    });
  }

  countFolderChildren(folderId: string) {
    return this.prisma.mediaFolder.count({
      where: { parentId: folderId, deletedAt: null },
    });
  }

  async softDeleteFolder(id: string) {
    try {
      return await this.prisma.mediaFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: MEDIA_FOLDER_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async createProcessingJob(
    data: Prisma.MediaProcessingJobUncheckedCreateInput,
  ) {
    try {
      return await this.prisma.mediaProcessingJob.create({
        data,
        select: { id: true, mediaId: true, jobType: true, status: true },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async markProcessingJobStarted(id: string) {
    return this.prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingJobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async markProcessingJobCompleted(id: string) {
    return this.prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingJobStatus.COMPLETED,
        completedAt: new Date(),
        errorMessage: null,
      },
      select: { id: true, mediaId: true },
    });
  }

  async markProcessingJobFailed(id: string, errorMessage: string) {
    return this.prisma.mediaProcessingJob.update({
      where: { id },
      data: {
        status: MediaProcessingJobStatus.FAILED,
        completedAt: new Date(),
        errorMessage,
      },
      select: { id: true, mediaId: true },
    });
  }

  async refreshMediaProcessingStatus(mediaId: string) {
    const [activeJobs, failedJobs] = await this.prisma.$transaction([
      this.prisma.mediaProcessingJob.count({
        where: {
          mediaId,
          deletedAt: null,
          status: {
            in: [
              MediaProcessingJobStatus.QUEUED,
              MediaProcessingJobStatus.PROCESSING,
            ],
          },
        },
      }),
      this.prisma.mediaProcessingJob.count({
        where: {
          mediaId,
          deletedAt: null,
          status: MediaProcessingJobStatus.FAILED,
        },
      }),
    ]);

    if (activeJobs > 0) {
      return;
    }

    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        processingStatus:
          failedJobs > 0
            ? MediaProcessingStatus.FAILED
            : MediaProcessingStatus.READY,
      },
      select: { id: true },
    });
  }

  async createLinks(
    mediaIds: string[],
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingCount = await tx.mediaLink.count({
          where: { entityType, entityId, context, deletedAt: null },
        });
        await Promise.all(
          mediaIds.map((mediaId, index) =>
            tx.mediaLink.create({
              data: {
                mediaId,
                entityType,
                entityId,
                context,
                isPrimary: existingCount === 0 && index === 0,
                sortOrder: existingCount + index,
              },
              select: { id: true },
            }),
          ),
        );

        return tx.mediaLink.findMany({
          where: { entityType, entityId, context, deletedAt: null },
          orderBy: { sortOrder: Prisma.SortOrder.asc },
          select: MEDIA_LINK_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findLinks(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    return this.prisma.mediaLink.findMany({
      where: { entityType, entityId, context, deletedAt: null },
      orderBy: { sortOrder: Prisma.SortOrder.asc },
      select: MEDIA_LINK_SELECT,
    });
  }

  countReadyLinks(entityType: MediaEntityType, entityId: string) {
    return this.prisma.mediaLink.count({
      where: {
        entityType,
        entityId,
        context: MediaContext.GALLERY,
        deletedAt: null,
        media: {
          deletedAt: null,
          processingStatus: MediaProcessingStatus.READY,
        },
      },
    });
  }

  async softDeleteLink(
    mediaId: string,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    return this.prisma.mediaLink.updateMany({
      where: { mediaId, entityType, entityId, context, deletedAt: null },
      data: { deletedAt: new Date(), isPrimary: false },
    });
  }

  async reorderLinks(
    entityType: MediaEntityType,
    entityId: string,
    items: ReorderMediaLinkItemDto[],
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const linkIds = items.map((item) => item.mediaLinkId);
        const existing = await tx.mediaLink.findMany({
          where: {
            id: { in: linkIds },
            entityType,
            entityId,
            deletedAt: null,
          },
          select: { id: true },
        });

        if (existing.length !== linkIds.length) {
          throw new NotFoundException('One or more media links were not found');
        }

        await Promise.all(
          items.map((item) =>
            tx.mediaLink.update({
              where: { id: item.mediaLinkId },
              data: { sortOrder: item.sortOrder },
              select: { id: true },
            }),
          ),
        );

        return tx.mediaLink.findMany({
          where: { entityType, entityId, deletedAt: null },
          orderBy: { sortOrder: Prisma.SortOrder.asc },
          select: MEDIA_LINK_SELECT,
        });
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
      throw new ConflictException('Media record already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Media record not found');
    }

    throw error;
  }
}
