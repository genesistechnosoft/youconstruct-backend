import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MEDIA_QUEUE } from '../../queue/queue.constants';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { MediaController } from './media.controller';
import { MediaProcessor } from './media.processor';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';

@Module({
  imports: [
    StorageModule,
    QueueModule,
    BullModule.registerQueue({
      name: MEDIA_QUEUE,
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService, MediaRepository, MediaProcessor],
  exports: [MediaService],
})
export class MediaModule {}
