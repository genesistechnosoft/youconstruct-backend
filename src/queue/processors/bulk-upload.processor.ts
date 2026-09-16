import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  BulkProductUploadStatus,
  NotificationEventType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { NotificationEmitterService } from '../../modules/notifications/notification-emitter.service';
import { BulkUploadRepository } from '../../modules/bulk-upload/bulk-upload.repository';
import { generateSlug } from '../../common/utils/slug.util';
import { normalizeProductTags } from '../../modules/products/product-tags.util';
import { BULK_PRODUCT_UPLOAD_QUEUE } from '../queue.constants';

type BulkUploadJobPayload = {
  uploadId: string;
  vendorId: string;
};

@Processor(BULK_PRODUCT_UPLOAD_QUEUE)
export class BulkUploadProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkUploadProcessor.name);

  constructor(
    private readonly bulkUploadRepository: BulkUploadRepository,
    private readonly notificationEmitter: NotificationEmitterService,
  ) {
    super();
  }

  async process(job: Job<BulkUploadJobPayload>) {
    const { uploadId, vendorId } = job.data;
    const started = Date.now();
    let importedCount = 0;
    let ok = false;
    this.logger.log(`Processing bulk upload ${uploadId}`);

    try {
      const upload = await this.bulkUploadRepository.findUploadById(uploadId);
      if (!upload) {
        this.logger.error(`Upload ${uploadId} not found`);
        return;
      }

      const validRows = await this.bulkUploadRepository.findValidRows(uploadId);
      let failedCount = 0;

      for (const row of validRows) {
        try {
          const rawData = row.rawData as Record<string, string>;

          const name = rawData['name']?.trim() ?? '';
          const categoryId = rawData['categoryId']?.trim() ?? '';
          const brandId = rawData['brandId']?.trim() || null;
          const description = rawData['description']?.trim() ?? '';
          const shortDescription = rawData['shortDescription']?.trim() ?? '';
          const sku = rawData['sku']?.trim() ?? '';
          const price = new Prisma.Decimal(rawData['price'] ?? '0');
          const sellingPrice = new Prisma.Decimal(
            rawData['sellingPrice'] ?? '0',
          );
          const costPriceStr = rawData['costPrice']?.trim() || null;
          const costPrice = costPriceStr
            ? new Prisma.Decimal(costPriceStr)
            : null;
          const primaryUnitCode = rawData['primaryUnitCode']?.trim() ?? '';
          const quantity = parseInt(rawData['quantity'] ?? '0', 10);
          const tagsStr = rawData['tags']?.trim() ?? '';
          const tags = normalizeProductTags(
            tagsStr
              ? tagsStr.split('|').map((t) => t.trim()).filter(Boolean)
              : [],
          );
          const metaTitle = rawData['metaTitle']?.trim() ?? '';
          const metaDescription = rawData['metaDescription']?.trim() ?? '';

          const unit =
            await this.bulkUploadRepository.findActiveUnitByCode(
              primaryUnitCode,
            );
          if (!unit) {
            await this.bulkUploadRepository.markRowFailed(
              row.id,
              `Unit with code "${primaryUnitCode}" not found`,
            );
            failedCount++;
            continue;
          }

          const slug = await this.generateUniqueSlug(name);

          const { productId, variantId } =
            await this.bulkUploadRepository.createProductWithVariant({
              vendorId,
              slug,
              categoryId,
              brandId,
              name,
              description,
              shortDescription,
              tags,
              metaTitle,
              metaDescription,
              sku,
              price,
              sellingPrice,
              costPrice,
              primaryUnitId: unit.id,
              quantity: isNaN(quantity) || quantity < 0 ? 0 : quantity,
            });

          await this.bulkUploadRepository.markRowImported(
            row.id,
            productId,
            variantId,
          );
          importedCount++;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Row ${row.id} failed: ${message}`);
          await this.bulkUploadRepository.markRowFailed(row.id, message);
          failedCount++;
        }
      }

      const finalStatus =
        importedCount > 0
          ? BulkProductUploadStatus.COMPLETED
          : BulkProductUploadStatus.FAILED;

      await this.bulkUploadRepository.updateUpload(uploadId, {
        status: finalStatus,
        importedRows: importedCount,
        errorMessage:
          failedCount > 0
            ? `${failedCount} row(s) failed to import`
            : null,
      });

      const eventType =
        finalStatus === BulkProductUploadStatus.COMPLETED
          ? NotificationEventType.BULK_UPLOAD_COMPLETED
          : NotificationEventType.BULK_UPLOAD_FAILED;

      this.notificationEmitter.emit({
        userId: upload.uploadedByUserId,
        eventType,
        title:
          finalStatus === BulkProductUploadStatus.COMPLETED
            ? 'Bulk upload completed'
            : 'Bulk upload failed',
        body:
          finalStatus === BulkProductUploadStatus.COMPLETED
            ? `Successfully imported ${importedCount} product(s).`
            : `Import failed. ${failedCount} row(s) could not be processed.`,
        data: { uploadId, importedCount, failedCount },
      });

      ok = finalStatus === BulkProductUploadStatus.COMPLETED;
      this.logger.log(
        `Bulk upload ${uploadId} done: ${importedCount} imported, ${failedCount} failed`,
      );
    } finally {
      this.logger.log(
        `bulk_upload_job jobId=${job.id ?? 'n/a'} uploadId=${uploadId} durationMs=${Date.now() - started} imported=${importedCount} ${ok ? 'ok' : 'fail'}`,
      );
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = generateSlug(name);
    let slug = base;
    let attempt = 0;

    while (await this.bulkUploadRepository.findSlugExists(slug)) {
      attempt++;
      slug = `${base}-${attempt}`;
    }

    return slug;
  }
}
