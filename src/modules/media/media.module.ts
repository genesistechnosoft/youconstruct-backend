import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MEDIA_PROCESSING_QUEUE } from '../../queue/queue.constants';
import { MediaProcessingProcessor } from '../../queue/processors/media-processing.processor';
import { VendorStoreModule } from '../vendor-store/vendor-store.module';
import { VendorMediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: MEDIA_PROCESSING_QUEUE }),
    VendorStoreModule,
  ],
  controllers: [VendorMediaController],
  providers: [MediaService, MediaRepository, MediaProcessingProcessor],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
