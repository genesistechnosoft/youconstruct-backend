import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaFileType,
  MediaProcessingStatus,
  MediaVisibility,
  Prisma,
  StorageDriver,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

const MEDIA_ASSET_SELECT = {
  id: true,
  mediaId: true,
  variantType: true,
  storageDriver: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  createdAt: true,
} as const;

const MEDIA_LINK_SELECT = {
  id: true,
  mediaId: true,
  entityType: true,
  entityId: true,
  context: true,
  isPrimary: true,
  sortOrder: true,
  createdAt: true,
  deletedAt: true,
} as const;

const assetOrderBy: Prisma.MediaAssetOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
];

const linkOrderBy: Prisma.MediaLinkOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];

const MEDIA_WITH_ASSETS_SELECT = {
  id: true,
  uploadedById: true,
  fileName: true,
  fileType: true,
  visibility: true,
  checksum: true,
  metadata: true,
  processingStatus: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  assets: {
    orderBy: assetOrderBy,
    select: MEDIA_ASSET_SELECT,
  },
} as const;

const MEDIA_DETAIL_SELECT = {
  ...MEDIA_WITH_ASSETS_SELECT,
  links: {
    where: { deletedAt: null },
    orderBy: linkOrderBy,
    select: MEDIA_LINK_SELECT,
  },
} as const;

const MEDIA_LINK_WITH_MEDIA_SELECT = {
  ...MEDIA_LINK_SELECT,
  media: {
    select: MEDIA_WITH_ASSETS_SELECT,
  },
} as const;

export interface CreateMediaInput {
  id: string;
  uploadedById: string;
  fileName: string;
  fileType: MediaFileType;
  visibility: MediaVisibility;
  checksum: string;
  metadata?: Prisma.InputJsonValue;
  processingStatus: MediaProcessingStatus;
  originalAsset: {
    variantType: string;
    storageDriver: StorageDriver;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    width?: number;
    height?: number;
  };
}

export interface CreateAssetInput {
  mediaId: string;
  variantType: string;
  storageDriver: StorageDriver;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
  width?: number;
  height?: number;
}

export interface CreateLinkInput {
  mediaId: string;
  entityType: string;
  entityId: string;
  context?: string;
  isPrimary: boolean;
  sortOrder: number;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithOriginalAsset(input: CreateMediaInput) {
    try {
      return await this.prisma.media.create({
        data: {
          id: input.id,
          uploadedBy: { connect: { id: input.uploadedById } },
          fileName: input.fileName,
          fileType: input.fileType,
          visibility: input.visibility,
          checksum: input.checksum,
          metadata: input.metadata,
          processingStatus: input.processingStatus,
          assets: {
            create: {
              variantType: input.originalAsset.variantType,
              storageDriver: input.originalAsset.storageDriver,
              storageKey: input.originalAsset.storageKey,
              mimeType: input.originalAsset.mimeType,
              sizeBytes: input.originalAsset.sizeBytes,
              width: input.originalAsset.width,
              height: input.originalAsset.height,
            },
          },
        },
        select: MEDIA_DETAIL_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findById(id: string) {
    return this.prisma.media.findFirst({
      where: { id, deletedAt: null },
      select: MEDIA_DETAIL_SELECT,
    });
  }

  findAsset(mediaId: string, variantType: string) {
    return this.prisma.mediaAsset.findFirst({
      where: { mediaId, variantType },
      select: MEDIA_ASSET_SELECT,
    });
  }

  async upsertAsset(input: CreateAssetInput) {
    try {
      return await this.prisma.mediaAsset.upsert({
        where: {
          mediaId_variantType: {
            mediaId: input.mediaId,
            variantType: input.variantType,
          },
        },
        create: input,
        update: {
          storageDriver: input.storageDriver,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          width: input.width,
          height: input.height,
        },
        select: MEDIA_ASSET_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  updateProcessingStatus(id: string, processingStatus: MediaProcessingStatus) {
    return this.prisma.media.update({
      where: { id },
      data: { processingStatus },
      select: MEDIA_DETAIL_SELECT,
    });
  }

  async createLink(input: CreateLinkInput) {
    try {
      return await this.prisma.mediaLink.create({
        data: input,
        select: MEDIA_LINK_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findLinkById(id: string, mediaId: string) {
    return this.prisma.mediaLink.findFirst({
      where: { id, mediaId, deletedAt: null },
      select: MEDIA_LINK_SELECT,
    });
  }

  async softDeleteLink(id: string) {
    try {
      return await this.prisma.mediaLink.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: MEDIA_LINK_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findLinksByEntity(entityType: string, entityId: string) {
    return this.prisma.mediaLink.findMany({
      where: {
        entityType,
        entityId,
        deletedAt: null,
        media: { deletedAt: null },
      },
      orderBy: linkOrderBy,
      select: MEDIA_LINK_WITH_MEDIA_SELECT,
    });
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Media data already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Media not found');
    }

    throw error;
  }
}
