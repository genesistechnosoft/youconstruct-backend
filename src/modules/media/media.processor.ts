import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job } from 'bullmq';
import { buffer } from 'stream/consumers';
import sharp from 'sharp';
import {
  MediaFileType,
  MediaProcessingStatus,
  MediaVisibility,
  StorageDriver,
} from '../../../generated/prisma/client.js';
import { MEDIA_QUEUE, PROCESS_MEDIA_JOB } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { MEDIA_VARIANTS } from './media.constants';
import { MediaRepository } from './media.repository';
import { buildMediaStorageKey } from './media-storage-key.util';

interface ProcessMediaJob {
  mediaId: string;
}

@Injectable()
@Processor(MEDIA_QUEUE)
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessMediaJob>) {
    if (job.name !== PROCESS_MEDIA_JOB) {
      return;
    }

    const media = await this.mediaRepository.findById(job.data.mediaId);
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    if (media.fileType !== MediaFileType.IMAGE) {
      await this.mediaRepository.updateProcessingStatus(
        media.id,
        MediaProcessingStatus.READY,
      );
      return;
    }

    try {
      const original = media.assets.find(
        (asset) => asset.variantType === MEDIA_VARIANTS.ORIGINAL,
      );
      if (!original) {
        throw new NotFoundException('Original media asset not found');
      }

      const originalBuffer = await buffer(
        this.storageService.getReadStream(original.storageKey),
      );
      await this.createImageVariant({
        mediaId: media.id,
        visibility: media.visibility,
        createdAt: media.createdAt,
        sourceBuffer: originalBuffer,
        variantType: MEDIA_VARIANTS.COMPRESSED,
        width: 1280,
      });
      await this.createImageVariant({
        mediaId: media.id,
        visibility: media.visibility,
        createdAt: media.createdAt,
        sourceBuffer: originalBuffer,
        variantType: MEDIA_VARIANTS.THUMBNAIL,
        width: 320,
        height: 320,
      });
      await this.mediaRepository.updateProcessingStatus(
        media.id,
        MediaProcessingStatus.READY,
      );
    } catch (error) {
      this.logger.error(`Media processing failed: ${media.id}`, error);
      await this.mediaRepository.updateProcessingStatus(
        media.id,
        MediaProcessingStatus.FAILED,
      );
      throw error;
    }
  }

  private async createImageVariant(input: {
    mediaId: string;
    visibility: MediaVisibility;
    createdAt: Date;
    sourceBuffer: Buffer;
    variantType: string;
    width: number;
    height?: number;
  }) {
    const transformer = sharp(input.sourceBuffer)
      .rotate()
      .resize(input.width, input.height, {
        fit: input.height ? 'cover' : 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: input.variantType === MEDIA_VARIANTS.THUMBNAIL ? 75 : 82,
      });
    const output = await transformer.toBuffer({ resolveWithObject: true });
    const storageKey = buildMediaStorageKey({
      visibility: input.visibility,
      createdAt: input.createdAt,
      mediaId: input.mediaId,
      variantType: input.variantType,
      extension: 'jpg',
    });

    await this.storageService.save({
      buffer: output.data,
      storageKey,
      visibility:
        input.visibility === MediaVisibility.PUBLIC ? 'public' : 'private',
    });
    await this.mediaRepository.upsertAsset({
      mediaId: input.mediaId,
      variantType: input.variantType,
      storageDriver: StorageDriver.LOCAL,
      storageKey,
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(output.data.length),
      width: output.info.width,
      height: output.info.height,
    });
  }
}
