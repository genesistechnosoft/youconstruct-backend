import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  BULK_PRODUCT_UPLOAD_QUEUE,
  DEFAULT_QUEUE_JOB_OPTIONS,
} from '../../queue/queue.constants';
import { BulkUploadProcessor } from '../../queue/processors/bulk-upload.processor';
import {
  AdminBulkUploadController,
  VendorBulkUploadController,
} from './bulk-upload.controller';
import { BulkUploadRepository } from './bulk-upload.repository';
import { BulkUploadService } from './bulk-upload.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: BULK_PRODUCT_UPLOAD_QUEUE,
      defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [VendorBulkUploadController, AdminBulkUploadController],
  providers: [BulkUploadService, BulkUploadRepository, BulkUploadProcessor],
})
export class BulkUploadModule {}
