import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import sharp from 'sharp';
import { MediaProcessingJobType } from '../../../generated/prisma/client.js';
import { MediaRepository } from '../../modules/media/media.repository';
import { StorageService } from '../../storage/storage.service';
import { MEDIA_PROCESSING_QUEUE } from '../queue.constants';

interface MediaProcessingJobData {
  processingJobId: string;
  mediaId: string;
}

@Processor(MEDIA_PROCESSING_QUEUE)
export class MediaProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessingProcessor.name);

  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<MediaProcessingJobData>) {
    const { processingJobId, mediaId } = job.data;

    try {
      await this.mediaRepository.markProcessingJobStarted(processingJobId);
      const media = await this.mediaRepository.findMediaForProcessing(mediaId);
      if (!media) {
        throw new Error('Media not found for processing');
      }

      const buffer = await this.storageService.getObject(media.originalKey);
      if (job.name === MediaProcessingJobType.IMAGE_COMPRESS) {
        const optimizedKey = this.variantKey(
          media.originalKey,
          'optimized.webp',
        );
        const optimized = await sharp(buffer)
          .rotate()
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        await this.storageService.putObject(
          optimizedKey,
          optimized,
          'image/webp',
        );
        await this.mediaRepository.updateMedia(media.id, { optimizedKey });
      }

      if (job.name === MediaProcessingJobType.THUMBNAIL_GENERATE) {
        const thumbnailKey = this.variantKey(
          media.originalKey,
          'thumbnail.webp',
        );
        const thumbnail = await sharp(buffer)
          .rotate()
          .resize(320, 320, { fit: 'cover' })
          .webp({ quality: 78 })
          .toBuffer();
        await this.storageService.putObject(
          thumbnailKey,
          thumbnail,
          'image/webp',
        );
        await this.mediaRepository.updateMedia(media.id, { thumbnailKey });
      }

      const completed =
        await this.mediaRepository.markProcessingJobCompleted(processingJobId);
      await this.mediaRepository.refreshMediaProcessingStatus(
        completed.mediaId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Media processing failed: ${message}`);
      const failed = await this.mediaRepository.markProcessingJobFailed(
        processingJobId,
        message,
      );
      await this.mediaRepository.refreshMediaProcessingStatus(failed.mediaId);
    }
  }

  private variantKey(originalKey: string, fileName: string) {
    return originalKey.replace(/\/original[^/]*$/, `/${fileName}`);
  }
}
