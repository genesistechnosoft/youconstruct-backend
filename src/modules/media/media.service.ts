import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import sharp from 'sharp';
import {
  MediaAccessLevel,
  MediaContext,
  MediaEntityType,
  MediaFileType,
  MediaOwnerType,
  MediaProcessingJobType,
  MediaProcessingStatus,
} from '../../../generated/prisma/client.js';
import { paginationMeta } from '../../common/utils/pagination.util';
import { MEDIA_PROCESSING_QUEUE } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { VendorStoreService } from '../vendor-store/vendor-store.service';
import { CreateMediaFolderDto } from './dto/create-media-folder.dto';
import { FolderContentsQueryDto } from './dto/folder-contents-query.dto';
import { LinkMediaDto } from './dto/link-media.dto';
import { MediaFiltersDto } from './dto/media-filters.dto';
import { ReorderMediaLinksDto } from './dto/reorder-media-links.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { UpdateMediaFolderDto } from './dto/update-media-folder.dto';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaRepository } from './media.repository';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime']);
const DOCUMENT_MIME_TYPES = new Set(['application/pdf']);

const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const VIDEO_LIMIT_BYTES = 200 * 1024 * 1024;
const DOCUMENT_LIMIT_BYTES = 20 * 1024 * 1024;

export interface MediaOwner {
  ownerType: MediaOwnerType;
  ownerId: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => VendorStoreService))
    private readonly vendorStoreService: VendorStoreService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE)
    private readonly mediaQueue: Queue,
  ) {}

  async listVendorMedia(vendorProfileId: string, filters: MediaFiltersDto) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const { items, total } = await this.mediaRepository.findManyMedia(
      owner.ownerType,
      owner.ownerId,
      filters,
    );

    return {
      message: 'Media fetched successfully',
      data: await Promise.all(items.map((media) => this.withUrls(media))),
      meta: paginationMeta(filters.page ?? 1, filters.limit ?? 20, total),
    };
  }

  async getVendorMediaStats(vendorProfileId: string) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const { byType, folders } = await this.mediaRepository.getLibraryStats(
      owner.ownerType,
      owner.ownerId,
    );

    const counts: Record<MediaFileType, number> = {
      [MediaFileType.IMAGE]: 0,
      [MediaFileType.VIDEO]: 0,
      [MediaFileType.DOCUMENT]: 0,
    };
    let totalSizeBytes = 0;

    for (const row of byType) {
      counts[row.fileType] = row._count._all;
      totalSizeBytes += row._sum.sizeBytes ?? 0;
    }

    const images = counts[MediaFileType.IMAGE];
    const videos = counts[MediaFileType.VIDEO];
    const documents = counts[MediaFileType.DOCUMENT];

    return {
      message: 'Media stats fetched successfully',
      data: {
        totalAssets: images + videos + documents,
        folders,
        images,
        videos,
        documents,
        totalSizeBytes,
      },
    };
  }

  async uploadVendorMedia(
    actorUserId: string,
    vendorProfileId: string,
    file: Express.Multer.File | undefined,
    dto: UploadMediaDto,
  ) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const accessLevel = dto.accessLevel ?? MediaAccessLevel.PUBLIC;
    if (
      accessLevel !== MediaAccessLevel.PUBLIC &&
      accessLevel !== MediaAccessLevel.SIGNED
    ) {
      throw new BadRequestException(
        'Vendor media library only allows PUBLIC or SIGNED access levels',
      );
    }

    const media = await this.uploadMedia({
      userId: actorUserId,
      owner,
      file,
      folderId: dto.folderId,
      accessLevel,
      keyPrefix: `vendors/${owner.ownerId}/media`,
      allowedFileTypes: [MediaFileType.IMAGE, MediaFileType.VIDEO],
    });

    return {
      message: 'Media uploaded successfully',
      data: await this.withUrls(media),
    };
  }

  async uploadVendorMediaForEntity(
    actorUserId: string,
    vendorId: string,
    file: Express.Multer.File | undefined,
    entityType: MediaEntityType,
    entityId: string,
  ) {
    await this.getApprovedVendorOwner(vendorId);
    const media = await this.uploadMedia({
      userId: actorUserId,
      owner: { ownerType: MediaOwnerType.VENDOR, ownerId: vendorId },
      file,
      accessLevel: MediaAccessLevel.PUBLIC,
      keyPrefix: `vendors/${vendorId}/media`,
      allowedFileTypes: [MediaFileType.IMAGE, MediaFileType.VIDEO],
    });

    await this.linkMediaToEntity(
      { ownerType: MediaOwnerType.VENDOR, ownerId: vendorId },
      entityType,
      entityId,
      { mediaIds: [media.id] },
    );

    return {
      message: 'Media uploaded and linked successfully',
      data: await this.withUrls(media),
    };
  }

  async uploadPrivateDocument(
    userId: string,
    owner: MediaOwner,
    file: Express.Multer.File | undefined,
    keyPrefix: string,
  ) {
    return this.uploadMedia({
      userId,
      owner,
      file,
      accessLevel: MediaAccessLevel.PRIVATE,
      keyPrefix,
      allowedFileTypes: [MediaFileType.DOCUMENT, MediaFileType.IMAGE],
    });
  }

  /**
   * Resolve a fresh URL for a USER-owned PRIVATE compliance document.
   * Not used by the vendor media library.
   */
  async getPrivateUserDocumentUrl(mediaId: string, userId: string) {
    const media = await this.mediaRepository.findMediaByOwner(
      mediaId,
      MediaOwnerType.USER,
      userId,
    );
    if (!media || media.accessLevel !== MediaAccessLevel.PRIVATE) {
      throw new NotFoundException('Document not found');
    }

    return this.storageService.getUrl(media.originalKey, media.accessLevel);
  }

  async listVendorFolders(vendorProfileId: string) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const folders = await this.mediaRepository.listFolders(
      owner.ownerType,
      owner.ownerId,
    );

    return { message: 'Media folders fetched successfully', data: folders };
  }

  async getVendorFolderContents(
    vendorProfileId: string,
    folderId: string | null,
    query: FolderContentsQueryDto,
  ) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const folder = folderId
      ? await this.getFolderOrThrow(owner, folderId)
      : { id: null, name: null, parentId: null };

    const [folders, { items, total }] = await Promise.all([
      this.mediaRepository.listChildFolders(
        owner.ownerType,
        owner.ownerId,
        folderId,
      ),
      this.mediaRepository.findFolderMedia(
        owner.ownerType,
        owner.ownerId,
        folderId,
        query,
      ),
    ]);

    return {
      message: 'Folder fetched successfully',
      data: {
        folder: {
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
        },
        folders,
        media: await Promise.all(
          items.map((item) => this.withFolderBrowseUrls(item)),
        ),
      },
      meta: paginationMeta(query.page ?? 1, query.limit ?? 20, total),
    };
  }

  async createVendorFolder(vendorProfileId: string, dto: CreateMediaFolderDto) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    await this.validateFolderParent(owner, dto.parentId);

    const folder = await this.mediaRepository.createFolder({
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      name: dto.name,
      parentId: dto.parentId,
    });

    return { message: 'Media folder created successfully', data: folder };
  }

  async updateVendorFolder(
    vendorProfileId: string,
    folderId: string,
    dto: UpdateMediaFolderDto,
  ) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    await this.getFolderOrThrow(owner, folderId);

    if (dto.parentId === folderId) {
      throw new BadRequestException('Folder cannot be moved into itself');
    }

    if (dto.parentId !== undefined) {
      await this.validateFolderParent(owner, dto.parentId);
    }

    const folder = await this.mediaRepository.updateFolder(folderId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.parentId !== undefined && { parentId: dto.parentId }),
    });

    return { message: 'Media folder updated successfully', data: folder };
  }

  async deleteVendorFolder(vendorProfileId: string, folderId: string) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    await this.getFolderOrThrow(owner, folderId);

    const [mediaCount, childCount] = await Promise.all([
      this.mediaRepository.countFolderMedia(folderId),
      this.mediaRepository.countFolderChildren(folderId),
    ]);

    if (mediaCount > 0 || childCount > 0) {
      throw new BadRequestException(
        'Folder cannot be deleted while it contains media or subfolders',
      );
    }

    await this.mediaRepository.softDeleteFolder(folderId);
    return { message: 'Media folder deleted successfully', data: null };
  }

  async updateVendorMedia(
    vendorProfileId: string,
    mediaId: string,
    dto: UpdateMediaDto,
  ) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    await this.getMediaOrThrow(owner, mediaId);

    if (dto.folderId !== undefined) {
      await this.validateFolderParent(owner, dto.folderId);
    }

    const media = await this.mediaRepository.updateMedia(mediaId, {
      ...(dto.fileName !== undefined && { fileName: dto.fileName }),
      ...(dto.folderId !== undefined && { folderId: dto.folderId }),
    });

    return {
      message: 'Media updated successfully',
      data: await this.withUrls(media),
    };
  }

  async deleteVendorMedia(vendorProfileId: string, mediaId: string) {
    const owner = await this.getApprovedVendorOwner(vendorProfileId);
    const media = await this.getMediaOrThrow(owner, mediaId);
    const activeLinks = await this.mediaRepository.countActiveLinks(mediaId);

    if (activeLinks > 0) {
      throw new BadRequestException(
        'Media is linked to an entity. Unlink it before deleting',
      );
    }

    await this.mediaRepository.softDeleteMedia(mediaId);
    await this.deleteStoredObjects(media);
    await this.mediaRepository.decrementVendorStorageUsed(
      owner.ownerId,
      media.sizeBytes,
    );

    return { message: 'Media deleted successfully', data: null };
  }

  async linkMediaToEntity(
    owner: MediaOwner,
    entityType: MediaEntityType,
    entityId: string,
    dto: LinkMediaDto,
  ) {
    const media = await this.mediaRepository.findMediaByIds(
      owner.ownerType,
      owner.ownerId,
      dto.mediaIds,
    );

    if (media.length !== dto.mediaIds.length) {
      throw new NotFoundException('One or more media records were not found');
    }

    const links = await this.mediaRepository.createLinks(
      dto.mediaIds,
      entityType,
      entityId,
      MediaContext.GALLERY,
    );

    return {
      message: 'Media linked successfully',
      data: await Promise.all(
        links.map((link) => this.withMediaLinkUrls(link)),
      ),
    };
  }

  async unlinkMediaFromEntity(
    entityType: MediaEntityType,
    entityId: string,
    mediaId: string,
  ) {
    await this.mediaRepository.softDeleteLink(
      mediaId,
      entityType,
      entityId,
      MediaContext.GALLERY,
    );

    return { message: 'Media unlinked successfully', data: null };
  }

  async setEntityMediaContext(
    owner: MediaOwner,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
    mediaId: string,
  ) {
    const media = await this.mediaRepository.findMediaByIds(
      owner.ownerType,
      owner.ownerId,
      [mediaId],
    );
    if (media.length !== 1) {
      throw new NotFoundException('Media record not found');
    }

    const links = await this.mediaRepository.replaceLink(
      mediaId,
      entityType,
      entityId,
      context,
    );

    return {
      message: 'Media linked successfully',
      data: await Promise.all(
        links.map((link) => this.withMediaLinkUrls(link)),
      ),
    };
  }

  async uploadVendorMediaForEntityContext(
    actorUserId: string,
    vendorId: string,
    file: Express.Multer.File | undefined,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    await this.getApprovedVendorOwner(vendorId);
    const media = await this.uploadMedia({
      userId: actorUserId,
      owner: { ownerType: MediaOwnerType.VENDOR, ownerId: vendorId },
      file,
      accessLevel: MediaAccessLevel.PUBLIC,
      keyPrefix: `vendors/${vendorId}/media`,
      allowedFileTypes: [MediaFileType.IMAGE],
    });

    await this.setEntityMediaContext(
      { ownerType: MediaOwnerType.VENDOR, ownerId: vendorId },
      entityType,
      entityId,
      context,
      media.id,
    );

    return {
      message: 'Media uploaded and linked successfully',
      data: await this.withUrls(media),
    };
  }

  async uploadAdminEntityMedia(
    actorUserId: string,
    file: Express.Multer.File | undefined,
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
    keyPrefix: string,
  ) {
    const previousLinks = await this.mediaRepository.findLinks(
      entityType,
      entityId,
      context,
    );
    const previousMediaIds = previousLinks.map((link) => link.mediaId);
    const owner: MediaOwner = {
      ownerType: MediaOwnerType.ADMIN,
      ownerId: actorUserId,
    };

    const media = await this.uploadMedia({
      userId: actorUserId,
      owner,
      file,
      accessLevel: MediaAccessLevel.PUBLIC,
      keyPrefix,
      allowedFileTypes: [MediaFileType.IMAGE],
    });

    await this.setEntityMediaContext(
      owner,
      entityType,
      entityId,
      context,
      media.id,
    );
    await this.softDeleteUnlinkedMedia(previousMediaIds);

    return {
      message: 'Media uploaded and linked successfully',
      data: await this.withUrls(media),
    };
  }

  async clearEntityMediaContext(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    await this.mediaRepository.softDeleteLinksByContext(
      entityType,
      entityId,
      context,
    );

    return { message: 'Media unlinked successfully', data: null };
  }

  async clearEntityMediaContextAndDelete(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    const links = await this.mediaRepository.findLinks(
      entityType,
      entityId,
      context,
    );
    const mediaIds = links.map((link) => link.mediaId);

    await this.mediaRepository.softDeleteLinksByContext(
      entityType,
      entityId,
      context,
    );
    await this.softDeleteUnlinkedMedia(mediaIds);

    return { message: 'Media unlinked successfully', data: null };
  }

  async getEntityMediaByContext(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    const links = await this.mediaRepository.findLinks(
      entityType,
      entityId,
      context,
    );
    if (links.length === 0) {
      return null;
    }

    const withUrls = await this.withMediaLinkUrls(links[0]);
    const storageKey =
      withUrls.media.optimizedKey ??
      withUrls.media.thumbnailKey ??
      withUrls.media.originalKey;

    return {
      url:
        withUrls.media.optimizedUrl ??
        withUrls.media.thumbnailUrl ??
        withUrls.media.originalUrl,
      storageKey,
      mediaId: withUrls.mediaId,
      media: withUrls.media,
    };
  }

  async reorderEntityMedia(
    entityType: MediaEntityType,
    entityId: string,
    dto: ReorderMediaLinksDto,
  ) {
    const links = await this.mediaRepository.reorderLinks(
      entityType,
      entityId,
      dto.mediaIds,
      MediaContext.GALLERY,
    );

    return {
      message: 'Media links reordered successfully',
      data: await Promise.all(
        links.map((link) => this.withMediaLinkUrls(link)),
      ),
    };
  }

  countContextLinks(
    entityType: MediaEntityType,
    entityId: string,
    context: MediaContext,
  ) {
    return this.mediaRepository.countContextLinks(
      entityType,
      entityId,
      context,
    );
  }

  async getThumbnailsForEntities(entityIds: string[]) {
    const links = await this.mediaRepository.findLinksByEntityIds(
      MediaEntityType.PRODUCT,
      entityIds,
      MediaContext.THUMBNAIL,
      false,
    );
    const withUrls = await Promise.all(
      links.map((link) => this.withMediaLinkUrls(link)),
    );

    const map = new Map<string, (typeof withUrls)[number] | null>();
    for (const entityId of entityIds) {
      map.set(entityId, null);
    }
    for (const link of withUrls) {
      if (!map.get(link.entityId)) {
        map.set(link.entityId, link);
      }
    }

    return map;
  }

  async findOwnedMediaIds(owner: MediaOwner, mediaIds: string[]) {
    if (mediaIds.length === 0) {
      return [];
    }

    const rows = await this.mediaRepository.findMediaByIds(
      owner.ownerType,
      owner.ownerId,
      mediaIds,
    );
    return rows.map((row) => row.id);
  }

  async getOrderedGalleryMediaIds(
    entityType: MediaEntityType,
    entityIds: string[],
  ) {
    const map = new Map<string, string[]>();
    for (const entityId of entityIds) {
      map.set(entityId, []);
    }
    if (entityIds.length === 0) {
      return map;
    }

    const links = await this.mediaRepository.findLinksByEntityIds(
      entityType,
      entityIds,
      MediaContext.GALLERY,
      false,
    );
    for (const link of links) {
      map.get(link.entityId)?.push(link.mediaId);
    }
    return map;
  }

  async getEntityThumbnail(entityType: MediaEntityType, entityId: string) {
    const links = await this.mediaRepository.findLinks(
      entityType,
      entityId,
      MediaContext.THUMBNAIL,
    );
    if (links.length === 0) {
      return null;
    }

    return this.withMediaLinkUrls(links[0]);
  }

  async getEntityGallery(entityType: MediaEntityType, entityId: string) {
    const links = await this.mediaRepository.findLinks(
      entityType,
      entityId,
      MediaContext.GALLERY,
    );

    return Promise.all(links.map((link) => this.withMediaLinkUrls(link)));
  }

  async getGalleriesForEntities(
    entityType: MediaEntityType,
    entityIds: string[],
  ) {
    const links = await this.mediaRepository.findLinksByEntityIds(
      entityType,
      entityIds,
      MediaContext.GALLERY,
    );
    const withUrls = await Promise.all(
      links.map((link) => this.withMediaLinkUrls(link)),
    );

    const map = new Map<string, typeof withUrls>();
    for (const link of withUrls) {
      const existing = map.get(link.entityId) ?? [];
      existing.push(link);
      map.set(link.entityId, existing);
    }

    return map;
  }

  async getPrimaryImagesForEntities(
    entityType: MediaEntityType,
    entityIds: string[],
  ): Promise<Map<string, { url: string; storageKey: string } | null>> {
    const result = new Map<
      string,
      { url: string; storageKey: string } | null
    >();

    for (const entityId of entityIds) {
      result.set(entityId, null);
    }

    if (entityIds.length === 0) {
      return result;
    }

    const applyLinks = async (
      links: Awaited<ReturnType<MediaRepository['findLinksByEntityIds']>>,
    ) => {
      for (const link of links) {
        if (result.get(link.entityId)) {
          continue;
        }

        const storageKey =
          link.media.optimizedKey ??
          link.media.thumbnailKey ??
          link.media.originalKey;
        const url = await this.storageService.getUrl(
          storageKey,
          link.media.accessLevel,
        );
        result.set(link.entityId, { url, storageKey });
      }
    };

    if (entityType === MediaEntityType.PRODUCT) {
      const thumbnails = await this.mediaRepository.findLinksByEntityIds(
        entityType,
        entityIds,
        MediaContext.THUMBNAIL,
        false,
      );
      await applyLinks(thumbnails);
    }

    const missing = entityIds.filter((id) => result.get(id) === null);
    if (missing.length > 0) {
      const fallback = await this.mediaRepository.findLinksByEntityIds(
        entityType,
        missing,
      );
      await applyLinks(fallback);
    }

    return result;
  }

  async getContextFilesForEntities(
    entityType: MediaEntityType,
    entityIds: string[],
    context: MediaContext,
  ): Promise<Map<string, { url: string; storageKey: string } | null>> {
    const links = await this.mediaRepository.findLinksByEntityIds(
      entityType,
      entityIds,
      context,
    );
    const result = new Map<
      string,
      { url: string; storageKey: string } | null
    >();

    for (const entityId of entityIds) {
      result.set(entityId, null);
    }

    for (const link of links) {
      if (result.get(link.entityId)) {
        continue;
      }

      const storageKey =
        link.media.optimizedKey ??
        link.media.thumbnailKey ??
        link.media.originalKey;
      const url = await this.storageService.getUrl(
        storageKey,
        link.media.accessLevel,
      );
      result.set(link.entityId, { url, storageKey });
    }

    return result;
  }

  async getContextMediaForEntities(
    entityType: MediaEntityType,
    entityIds: string[],
    context: MediaContext,
  ): Promise<
    Map<
      string,
      {
        mediaId: string;
        processingStatus: MediaProcessingStatus;
        originalUrl: string;
        optimizedUrl: string | null;
        thumbnailUrl: string | null;
      } | null
    >
  > {
    const links = await this.mediaRepository.findLinksByEntityIds(
      entityType,
      entityIds,
      context,
      false,
    );
    const result = new Map<
      string,
      {
        mediaId: string;
        processingStatus: MediaProcessingStatus;
        originalUrl: string;
        optimizedUrl: string | null;
        thumbnailUrl: string | null;
      } | null
    >();

    for (const entityId of entityIds) {
      result.set(entityId, null);
    }

    for (const link of links) {
      if (result.get(link.entityId)) {
        continue;
      }

      const withUrls = await this.withUrls(link.media);
      result.set(link.entityId, {
        mediaId: link.mediaId,
        processingStatus: withUrls.processingStatus,
        originalUrl: withUrls.originalUrl,
        optimizedUrl: withUrls.optimizedUrl,
        thumbnailUrl: withUrls.thumbnailUrl,
      });
    }

    return result;
  }

  private async withFolderBrowseUrls<
    T extends {
      originalKey: string;
      optimizedKey: string | null;
      thumbnailKey: string | null;
      accessLevel: MediaAccessLevel;
      uploader: { id: string; name: string };
      folder: { id: string; name: string } | null;
    },
  >(media: T) {
    const { uploader, folder, ...rest } = media;
    return {
      ...(await this.withUrls(rest)),
      uploader: { id: uploader.id, name: uploader.name },
      folder: folder ? { id: folder.id, name: folder.name } : null,
    };
  }

  async withUrls<
    T extends {
      originalKey: string;
      optimizedKey: string | null;
      thumbnailKey: string | null;
      accessLevel: MediaAccessLevel;
    },
  >(media: T) {
    return {
      ...media,
      originalUrl: await this.storageService.getUrl(
        media.originalKey,
        media.accessLevel,
      ),
      optimizedUrl: media.optimizedKey
        ? await this.storageService.getUrl(
            media.optimizedKey,
            media.accessLevel,
          )
        : null,
      thumbnailUrl: media.thumbnailKey
        ? await this.storageService.getUrl(
            media.thumbnailKey,
            media.accessLevel,
          )
        : null,
    };
  }

  private async uploadMedia(input: {
    userId: string;
    owner: MediaOwner;
    file: Express.Multer.File | undefined;
    folderId?: string;
    accessLevel: MediaAccessLevel;
    keyPrefix: string;
    allowedFileTypes: MediaFileType[];
  }) {
    if (!input.file) {
      throw new BadRequestException('File is required');
    }

    if (input.folderId) {
      await this.validateFolderParent(input.owner, input.folderId);
    }

    const fileType = this.getFileType(input.file);
    if (!input.allowedFileTypes.includes(fileType)) {
      throw new BadRequestException('File type is not allowed for this upload');
    }

    this.validateFileSize(input.file, fileType);
    this.validateMagicBytes(input.file, fileType);

    if (input.owner.ownerType === MediaOwnerType.VENDOR) {
      await this.vendorStoreService.assertCanUploadMedia(
        input.owner.ownerId,
        input.file.size,
      );
    }

    const id = randomUUID();
    const extension = this.getExtension(
      input.file.originalname,
      input.file.mimetype,
    );
    const originalKey = `${input.keyPrefix}/${id}/original${extension}`;
    const dimensions =
      fileType === MediaFileType.IMAGE
        ? await this.getImageDimensions(input.file.buffer)
        : {};

    await this.storageService.putObject(
      originalKey,
      input.file.buffer,
      input.file.mimetype,
    );

    const media = await this.mediaRepository.createMedia({
      id,
      uploadedBy: input.userId,
      ownerType: input.owner.ownerType,
      ownerId: input.owner.ownerId,
      folderId: input.folderId,
      fileName: this.toDisplayName(input.file.originalname),
      originalName: input.file.originalname,
      fileType,
      mimeType: input.file.mimetype,
      sizeBytes: input.file.size,
      storageDriver: this.storageService.driver,
      originalKey,
      accessLevel: input.accessLevel,
      processingStatus:
        fileType === MediaFileType.IMAGE
          ? MediaProcessingStatus.PROCESSING
          : MediaProcessingStatus.READY,
      ...dimensions,
    });

    if (input.owner.ownerType === MediaOwnerType.VENDOR) {
      await this.mediaRepository.incrementVendorStorageUsed(
        input.owner.ownerId,
        input.file.size,
      );
    }

    if (fileType === MediaFileType.IMAGE) {
      await this.queueImageProcessingJobs(media.id);
    }

    return media;
  }

  private async queueImageProcessingJobs(mediaId: string) {
    const jobTypes = [
      MediaProcessingJobType.IMAGE_COMPRESS,
      MediaProcessingJobType.THUMBNAIL_GENERATE,
    ];

    await Promise.all(
      jobTypes.map(async (jobType) => {
        const job = await this.mediaRepository.createProcessingJob({
          mediaId,
          jobType,
        });
        await this.mediaQueue.add(
          jobType,
          { processingJobId: job.id, mediaId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 604800, count: 5000 },
          },
        );
      }),
    );
  }

  private async getApprovedVendorOwner(
    vendorProfileId: string,
  ): Promise<MediaOwner> {
    const vendor =
      await this.mediaRepository.findApprovedVendorById(vendorProfileId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile required');
    }

    return { ownerType: MediaOwnerType.VENDOR, ownerId: vendor.id };
  }

  private async validateFolderParent(owner: MediaOwner, folderId?: string) {
    if (!folderId) {
      return;
    }

    await this.getFolderOrThrow(owner, folderId);
  }

  private async getFolderOrThrow(owner: MediaOwner, folderId: string) {
    const folder = await this.mediaRepository.findFolderByOwner(
      folderId,
      owner.ownerType,
      owner.ownerId,
    );
    if (!folder) {
      throw new NotFoundException('Media folder not found');
    }

    return folder;
  }

  private async getMediaOrThrow(owner: MediaOwner, mediaId: string) {
    const media = await this.mediaRepository.findMediaByOwner(
      mediaId,
      owner.ownerType,
      owner.ownerId,
    );
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Defense in depth: vendor library APIs never operate on PRIVATE/KYC media
    if (
      owner.ownerType === MediaOwnerType.VENDOR &&
      media.accessLevel === MediaAccessLevel.PRIVATE
    ) {
      throw new NotFoundException('Media not found');
    }

    return media;
  }

  private async withMediaLinkUrls<
    T extends { media: Parameters<MediaService['withUrls']>[0] },
  >(link: T) {
    return { ...link, media: await this.withUrls(link.media) };
  }

  private getFileType(file: Express.Multer.File) {
    if (IMAGE_MIME_TYPES.has(file.mimetype)) {
      return MediaFileType.IMAGE;
    }
    if (VIDEO_MIME_TYPES.has(file.mimetype)) {
      return MediaFileType.VIDEO;
    }
    if (DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      return MediaFileType.DOCUMENT;
    }

    throw new BadRequestException('Unsupported file type');
  }

  private validateFileSize(file: Express.Multer.File, fileType: MediaFileType) {
    const limit =
      fileType === MediaFileType.IMAGE
        ? IMAGE_LIMIT_BYTES
        : fileType === MediaFileType.VIDEO
          ? VIDEO_LIMIT_BYTES
          : DOCUMENT_LIMIT_BYTES;

    if (file.size > limit) {
      throw new BadRequestException('File exceeds the allowed size limit');
    }
  }

  private validateMagicBytes(
    file: Express.Multer.File,
    fileType: MediaFileType,
  ) {
    const buffer = file.buffer;
    const isValid =
      fileType === MediaFileType.IMAGE
        ? this.hasImageSignature(buffer, file.mimetype)
        : fileType === MediaFileType.VIDEO
          ? buffer.subarray(4, 8).toString('ascii') === 'ftyp'
          : buffer.subarray(0, 4).toString('ascii') === '%PDF';

    if (!isValid) {
      throw new BadRequestException('File content does not match its type');
    }
  }

  private hasImageSignature(buffer: Buffer, mimeType: string) {
    if (mimeType === 'image/jpeg') {
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/png') {
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/webp') {
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }
    if (mimeType === 'image/gif') {
      return buffer.subarray(0, 3).toString('ascii') === 'GIF';
    }

    return false;
  }

  private async getImageDimensions(buffer: Buffer) {
    try {
      const metadata = await sharp(buffer).metadata();
      return { width: metadata.width, height: metadata.height };
    } catch {
      return {};
    }
  }

  private getExtension(originalName: string, mimeType: string) {
    const extension = extname(originalName).toLowerCase();
    if (extension) {
      return extension;
    }

    const fallback: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'application/pdf': '.pdf',
    };

    return fallback[mimeType] ?? '';
  }

  private toDisplayName(originalName: string) {
    return originalName.replace(/\.[^/.]+$/, '');
  }

  private async softDeleteUnlinkedMedia(mediaIds: string[]) {
    const uniqueIds = [...new Set(mediaIds)];

    for (const mediaId of uniqueIds) {
      const activeLinks = await this.mediaRepository.countActiveLinks(mediaId);
      if (activeLinks > 0) {
        continue;
      }

      const media = await this.mediaRepository.findMediaForProcessing(mediaId);
      if (!media) {
        continue;
      }

      await this.mediaRepository.softDeleteMedia(mediaId);
      await this.deleteStoredObjects(media);
    }
  }

  private async deleteStoredObjects(media: {
    originalKey: string;
    optimizedKey: string | null;
    thumbnailKey: string | null;
  }) {
    const keys = [
      media.originalKey,
      media.optimizedKey,
      media.thumbnailKey,
    ].filter((key): key is string => Boolean(key));
    await Promise.all(keys.map((key) => this.storageService.deleteObject(key)));
  }
}
