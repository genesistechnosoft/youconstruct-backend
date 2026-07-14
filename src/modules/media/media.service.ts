import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { ReadStream } from 'fs';
import { extname } from 'path';
import sharp from 'sharp';
import {
  MediaFileType,
  MediaProcessingStatus,
  MediaVisibility,
  Prisma,
  StorageDriver,
} from '../../../generated/prisma/client.js';
import { UserRole } from '../../common/decorators/roles.decorator';
import { MEDIA_QUEUE, PROCESS_MEDIA_JOB } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { CreateMediaLinkDto } from './dto/create-media-link.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MEDIA_VARIANTS,
  MediaVariant,
  VIDEO_MIME_TYPES,
} from './media.constants';
import { MediaRepository } from './media.repository';
import { buildMediaStorageKey } from './media-storage-key.util';
import { UploadedMediaFile } from './types/uploaded-media-file.type';

interface AuthUser {
  userId: string;
  role: UserRole;
}

interface ContentResult {
  mode: 'redirect' | 'stream';
  url?: string;
  stream?: ReadStream;
  mimeType: string;
  sizeBytes: bigint;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
    @InjectQueue(MEDIA_QUEUE) private readonly mediaQueue: Queue,
  ) {}

  async uploadMedia(
    user: AuthUser,
    file: UploadedMediaFile | undefined,
    dto: UploadMediaDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileType = this.resolveFileType(file.mimetype);
    this.validateFileSize(file, fileType);

    const mediaId = randomUUID();
    const createdAt = new Date();
    const extension = this.resolveExtension(file);
    const storageKey = buildMediaStorageKey({
      visibility: dto.visibility,
      createdAt,
      mediaId,
      variantType: MEDIA_VARIANTS.ORIGINAL,
      extension,
    });
    const metadata = this.parseMetadata(dto.metadata);
    const dimensions = await this.getImageDimensions(file, fileType);
    const processingStatus =
      fileType === MediaFileType.IMAGE
        ? MediaProcessingStatus.PENDING
        : MediaProcessingStatus.READY;

    await this.storageService.save({
      buffer: file.buffer,
      storageKey,
      visibility:
        dto.visibility === MediaVisibility.PUBLIC ? 'public' : 'private',
    });

    let media: Awaited<ReturnType<MediaRepository['createWithOriginalAsset']>>;
    try {
      media = await this.mediaRepository.createWithOriginalAsset({
        id: mediaId,
        uploadedById: user.userId,
        fileName: file.originalname,
        fileType,
        visibility: dto.visibility,
        checksum: this.getChecksum(file.buffer),
        metadata,
        processingStatus,
        originalAsset: {
          variantType: MEDIA_VARIANTS.ORIGINAL,
          storageDriver: StorageDriver.LOCAL,
          storageKey,
          mimeType: file.mimetype,
          sizeBytes: BigInt(file.size),
          width: dimensions.width,
          height: dimensions.height,
        },
      });
    } catch (error) {
      await this.safeDelete(storageKey);
      throw error;
    }

    if (fileType === MediaFileType.IMAGE) {
      await this.enqueueProcessing(mediaId);
    }

    return {
      message: 'Media uploaded successfully',
      data: this.serializeMedia(media),
    };
  }

  async getMedia(user: AuthUser, mediaId: string) {
    const media = await this.getAuthorizedMedia(user, mediaId);
    return {
      message: 'Media fetched successfully',
      data: this.serializeMedia(media),
    };
  }

  async getContent(
    user: AuthUser,
    mediaId: string,
    variantType: MediaVariant = MEDIA_VARIANTS.ORIGINAL,
  ): Promise<ContentResult> {
    const media = await this.getAuthorizedMedia(user, mediaId);
    const asset = media.assets.find((item) => item.variantType === variantType);
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }

    if (media.visibility === MediaVisibility.PUBLIC) {
      return {
        mode: 'redirect',
        url: this.storageService.getUrl(asset.storageKey),
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      };
    }

    return {
      mode: 'stream',
      stream: this.storageService.getReadStream(asset.storageKey),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    };
  }

  async createLink(user: AuthUser, mediaId: string, dto: CreateMediaLinkDto) {
    const media = await this.getAuthorizedMedia(user, mediaId);
    this.ensureCanMutate(user, media.uploadedById);

    const link = await this.mediaRepository.createLink({
      mediaId,
      entityType: this.normalizeEntityType(dto.entityType),
      entityId: dto.entityId,
      context: this.normalizeContext(dto.context),
      isPrimary: dto.isPrimary ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });

    return { message: 'Media linked successfully', data: link };
  }

  async deleteLink(user: AuthUser, mediaId: string, linkId: string) {
    const media = await this.getAuthorizedMedia(user, mediaId);
    this.ensureCanMutate(user, media.uploadedById);

    const link = await this.mediaRepository.findLinkById(linkId, mediaId);
    if (!link) {
      throw new NotFoundException('Media link not found');
    }

    await this.mediaRepository.softDeleteLink(linkId);
    return { message: 'Media unlinked successfully', data: null };
  }

  async getEntityMedia(user: AuthUser, entityType: string, entityId: string) {
    const links = await this.mediaRepository.findLinksByEntity(
      this.normalizeEntityType(entityType),
      entityId,
    );
    const visibleLinks = links.filter(
      (link) =>
        link.media.visibility === MediaVisibility.PUBLIC ||
        this.canAdmin(user) ||
        link.media.uploadedById === user.userId,
    );

    return {
      message: 'Entity media fetched successfully',
      data: visibleLinks.map((link) => ({
        ...link,
        media: this.serializeMedia(link.media),
      })),
    };
  }

  private async enqueueProcessing(mediaId: string) {
    try {
      await this.mediaQueue.add(
        PROCESS_MEDIA_JOB,
        { mediaId },
        {
          attempts: this.getConfigNumber('MEDIA_QUEUE_ATTEMPTS', 3),
          backoff: {
            type: 'exponential',
            delay: this.getConfigNumber('MEDIA_QUEUE_BACKOFF_MS', 2000),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue media processing job: ${mediaId}`,
        error,
      );
      await this.mediaRepository.updateProcessingStatus(
        mediaId,
        MediaProcessingStatus.FAILED,
      );
    }
  }

  private async getAuthorizedMedia(user: AuthUser, mediaId: string) {
    const media = await this.mediaRepository.findById(mediaId);
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    if (
      media.visibility === MediaVisibility.PRIVATE &&
      !this.canAdmin(user) &&
      media.uploadedById !== user.userId
    ) {
      throw new ForbiddenException('You do not have access to this media');
    }

    return media;
  }

  private ensureCanMutate(user: AuthUser, uploadedById: string) {
    if (!this.canAdmin(user) && uploadedById !== user.userId) {
      throw new ForbiddenException('You do not own this media');
    }
  }

  private canAdmin(user: AuthUser) {
    return user.role === UserRole.ADMIN;
  }

  private resolveFileType(mimeType: string) {
    if (this.includesMime(IMAGE_MIME_TYPES, mimeType)) {
      return MediaFileType.IMAGE;
    }

    if (this.includesMime(VIDEO_MIME_TYPES, mimeType)) {
      return MediaFileType.VIDEO;
    }

    if (this.includesMime(DOCUMENT_MIME_TYPES, mimeType)) {
      return MediaFileType.DOCUMENT;
    }

    throw new BadRequestException('Unsupported file type');
  }

  private validateFileSize(file: UploadedMediaFile, fileType: MediaFileType) {
    if (file.size <= 0) {
      throw new BadRequestException('File cannot be empty');
    }

    const limitByType = {
      [MediaFileType.IMAGE]: this.getConfigNumber(
        'MEDIA_MAX_IMAGE_SIZE_BYTES',
        10485760,
      ),
      [MediaFileType.VIDEO]: this.getConfigNumber(
        'MEDIA_MAX_VIDEO_SIZE_BYTES',
        209715200,
      ),
      [MediaFileType.DOCUMENT]: this.getConfigNumber(
        'MEDIA_MAX_DOCUMENT_SIZE_BYTES',
        20971520,
      ),
    };

    if (file.size > limitByType[fileType]) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }
  }

  private resolveExtension(file: UploadedMediaFile) {
    const extensionByMimeType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'application/pdf': 'pdf',
    };
    const mimeExtension = extensionByMimeType[file.mimetype];
    if (mimeExtension) {
      return mimeExtension;
    }

    const fileExtension = extname(file.originalname).replace(/^\./, '');
    if (!fileExtension) {
      throw new BadRequestException('File extension is required');
    }

    return fileExtension;
  }

  private async getImageDimensions(
    file: UploadedMediaFile,
    fileType: MediaFileType,
  ) {
    if (fileType !== MediaFileType.IMAGE) {
      return {};
    }

    const metadata = await sharp(file.buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  }

  private getChecksum(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private parseMetadata(metadata?: string): Prisma.InputJsonValue | undefined {
    if (!metadata) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(metadata);
      if (!this.isJsonValue(parsed)) {
        throw new BadRequestException('Metadata must be valid JSON');
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Metadata must be valid JSON');
    }
  }

  private isJsonValue(value: unknown): value is Prisma.InputJsonValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.every((item) => this.isJsonValue(item));
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).every((item) =>
        this.isJsonValue(item),
      );
    }

    return false;
  }

  private serializeMedia<T extends { assets: { sizeBytes: bigint }[] }>(
    media: T,
  ) {
    return {
      ...media,
      assets: media.assets.map((asset) => ({
        ...asset,
        sizeBytes: asset.sizeBytes.toString(),
      })),
    };
  }

  private normalizeEntityType(entityType: string) {
    return entityType.trim().toUpperCase();
  }

  private normalizeContext(context?: string) {
    return context?.trim().toLowerCase();
  }

  private includesMime(values: readonly string[], mimeType: string) {
    return values.includes(mimeType);
  }

  private getConfigNumber(key: string, fallback: number) {
    const value = this.config.get<string | number>(key);
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    return Number(value);
  }

  private async safeDelete(storageKey: string) {
    try {
      await this.storageService.delete(storageKey);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup uploaded media object: ${storageKey}`,
        error,
      );
    }
  }
}
