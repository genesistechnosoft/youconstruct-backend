import {
  BadRequestException,
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
import {
  FolderContentsQueryDto,
  MediaSortBy,
  MediaSortOrder,
} from './dto/folder-contents-query.dto';
import { MediaFiltersDto } from './dto/media-filters.dto';

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

export const FOLDER_BROWSE_MEDIA_SELECT = {
  ...MEDIA_SELECT,
  uploader: {
    select: { id: true, name: true },
  },
  folder: {
    select: { id: true, name: true },
  },
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

  async getLibraryStats(ownerType: MediaOwnerType, ownerId: string) {
    const libraryWhere: Prisma.MediaWhereInput = {
      ownerType,
      ownerId,
      deletedAt: null,
      accessLevel: {
        in: [MediaAccessLevel.PUBLIC, MediaAccessLevel.SIGNED],
      },
      kycDocuments: { none: {} },
    };

    const [byType, folders] = await Promise.all([
      this.prisma.media.groupBy({
        by: ['fileType'],
        where: libraryWhere,
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.mediaFolder.count({
        where: { ownerType, ownerId, deletedAt: null },
      }),
    ]);

    return { byType, folders };
  }

  async findFolderMedia(
    ownerType: MediaOwnerType,
    ownerId: string,
    folderId: string | null,
    query: FolderContentsQueryDto,
  ) {
    const { skip, take } = paginate(query.page, query.limit);
    const search = query.search?.trim();
    const sortOrder =
      query.sortOrder === MediaSortOrder.ASC
        ? Prisma.SortOrder.asc
        : Prisma.SortOrder.desc;
    const sortField =
      query.sortBy === MediaSortBy.FILE_NAME
        ? 'fileName'
        : query.sortBy === MediaSortBy.SIZE_BYTES
          ? 'sizeBytes'
          : 'createdAt';
    const where: Prisma.MediaWhereInput = {
      ownerType,
      ownerId,
      deletedAt: null,
      folderId,
      accessLevel: {
        in: [MediaAccessLevel.PUBLIC, MediaAccessLevel.SIGNED],
      },
      kycDocuments: { none: {} },
      ...(query.fileType && { fileType: query.fileType }),
      ...(search && {
        OR: [
          { fileName: { contains: search, mode: 'insensitive' } },
          { originalName: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.media.findMany({
        where,
        skip,
        take,
        orderBy: { [sortField]: sortOrder },
        select: FOLDER_BROWSE_MEDIA_SELECT,
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

  async listChildFolders(
    ownerType: MediaOwnerType,
    ownerId: string,
    parentId: string | null,
  ) {
    const folders = await this.prisma.mediaFolder.findMany({
      where: { ownerType, ownerId, parentId, deletedAt: null },
      orderBy: { name: Prisma.SortOrder.asc },
      select: {
        ...MEDIA_FOLDER_SELECT,
        _count: {
          select: {
            media: { where: { deletedAt: null } },
            children: { where: { deletedAt: null } },
          },
        },
      },
    });

    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      mediaCount: folder._count.media,
      childCount: folder._count.children,
      createdAt: folder.createdAt,
    }));
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

  findLinksByEntityIds(
    entityType: MediaEntityType,
    entityIds: string[],
    context?: MediaContext,
    readyOnly = true,
  ) {
    if (entityIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.mediaLink.findMany({
      where: {
        entityType,
        entityId: { in: entityIds },
        deletedAt: null,
        ...(context && { context }),
        media: {
          deletedAt: null,
          ...(readyOnly && {
            processingStatus: MediaProcessingStatus.READY,
          }),
        },
      },
      orderBy: [
        { isPrimary: Prisma.SortOrder.desc },
        { sortOrder: Prisma.SortOrder.asc },
      ],
      select: MEDIA_LINK_SELECT,
    });
  }

  countContextLinks(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    return this.prisma.mediaLink.count({
      where: {
        entityType,
        entityId,
        context,
        deletedAt: null,
        media: { deletedAt: null },
      },
    });
  }

  async softDeleteLink(
    mediaId: string,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    const result = await this.prisma.mediaLink.updateMany({
      where: { mediaId, entityType, entityId, context, deletedAt: null },
      data: { deletedAt: new Date(), isPrimary: false },
    });

    if (result.count === 0) {
      throw new NotFoundException('Media link not found');
    }

    return result;
  }

  async softDeleteLinksByContext(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    return this.prisma.mediaLink.updateMany({
      where: { entityType, entityId, context, deletedAt: null },
      data: { deletedAt: new Date(), isPrimary: false },
    });
  }

  async replaceLink(
    mediaId: string,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.mediaLink.updateMany({
          where: { entityType, entityId, context, deletedAt: null },
          data: { deletedAt: new Date(), isPrimary: false },
        });

        await tx.mediaLink.create({
          data: {
            mediaId,
            entityType,
            entityId,
            context,
            isPrimary: true,
            sortOrder: 0,
          },
          select: { id: true },
        });

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

  async reorderLinks(
    entityType: MediaEntityType,
    entityId: string,
    mediaIds: string[],
    context: MediaContext,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const uniqueIds = [...new Set(mediaIds)];
        if (uniqueIds.length !== mediaIds.length) {
          throw new BadRequestException('Duplicate media IDs are not allowed');
        }

        const galleryCount = await tx.mediaLink.count({
          where: { entityType, entityId, context, deletedAt: null },
        });
        if (galleryCount !== mediaIds.length) {
          throw new BadRequestException(
            'Reorder must include every gallery media ID exactly once',
          );
        }

        const existing = await tx.mediaLink.findMany({
          where: {
            mediaId: { in: mediaIds },
            entityType,
            entityId,
            context,
            deletedAt: null,
          },
          select: { id: true, mediaId: true },
        });

        if (existing.length !== mediaIds.length) {
          throw new NotFoundException('One or more media links were not found');
        }

        const linkByMediaId = new Map(
          existing.map((link) => [link.mediaId, link.id]),
        );

        await Promise.all(
          mediaIds.map((mediaId, index) => {
            const linkId = linkByMediaId.get(mediaId);
            if (!linkId) {
              throw new NotFoundException(
                'One or more media links were not found',
              );
            }

            return tx.mediaLink.update({
              where: { id: linkId },
              data: { sortOrder: index, isPrimary: index === 0 },
              select: { id: true },
            });
          }),
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
