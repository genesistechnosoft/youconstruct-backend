import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BulkProductUploadRowStatus,
  BulkProductUploadStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { paginationMeta } from '../../common/utils/pagination.util';
import { BULK_PRODUCT_UPLOAD_QUEUE } from '../../queue/queue.constants';
import { BulkUploadRepository } from './bulk-upload.repository';
import { parseCsv } from './csv-parser.util';
import type { ListBulkUploadsQueryDto } from './dto/list-bulk-uploads-query.dto';

@Injectable()
export class BulkUploadService {
  private readonly logger = new Logger(BulkUploadService.name);

  constructor(
    private readonly bulkUploadRepository: BulkUploadRepository,
    @InjectQueue(BULK_PRODUCT_UPLOAD_QUEUE)
    private readonly bulkQueue: Queue,
  ) {}

  async uploadCsv(
    userId: string,
    file: Express.Multer.File | undefined,
    query: ListBulkUploadsQueryDto,
  ) {
    void query;
    const vendor = await this.bulkUploadRepository.findVendorByUserId(userId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile not found');
    }

    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    if (
      !file.originalname.endsWith('.csv') &&
      file.mimetype !== 'text/csv' &&
      file.mimetype !== 'application/vnd.ms-excel'
    ) {
      throw new BadRequestException('Only CSV files are supported');
    }

    const csvContent = file.buffer.toString('utf-8');
    const upload = await this.bulkUploadRepository.createUpload({
      vendorId: vendor.id,
      uploadedByUserId: userId,
      fileName: file.originalname,
      storageKey: null,
    });

    await this.validateAndSaveRows(upload.id, vendor.id, csvContent);

    const refreshed = await this.bulkUploadRepository.findUploadById(upload.id);
    return { message: 'CSV uploaded and validated', data: refreshed };
  }

  async getUpload(userId: string, uploadId: string) {
    const vendor = await this.bulkUploadRepository.findVendorByUserId(userId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile not found');
    }

    const upload = await this.bulkUploadRepository.findUploadWithRows(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload not found');
    }
    if (upload.vendorId !== vendor.id) {
      throw new ForbiddenException('You do not own this upload');
    }

    return { message: 'Upload fetched successfully', data: upload };
  }

  async listUploads(userId: string, dto: ListBulkUploadsQueryDto) {
    const vendor = await this.bulkUploadRepository.findVendorByUserId(userId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile not found');
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const [uploads, total] = await Promise.all([
      this.bulkUploadRepository.findUploadsByVendor(vendor.id, page, limit),
      this.bulkUploadRepository.countUploadsByVendor(vendor.id),
    ]);

    return {
      message: 'Uploads fetched successfully',
      data: uploads,
      meta: paginationMeta(page, limit, total),
    };
  }

  async confirmUpload(userId: string, uploadId: string) {
    const vendor = await this.bulkUploadRepository.findVendorByUserId(userId);
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile not found');
    }

    const upload = await this.bulkUploadRepository.findUploadById(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload not found');
    }
    if (upload.vendorId !== vendor.id) {
      throw new ForbiddenException('You do not own this upload');
    }
    if (upload.status !== BulkProductUploadStatus.VALIDATED) {
      throw new BadRequestException(
        'Upload must be in VALIDATED status to confirm',
      );
    }

    const membership = await this.bulkUploadRepository.findVendorMembership(
      vendor.id,
    );
    if (!membership?.isActive) {
      throw new ForbiddenException('Vendor membership is inactive');
    }

    if (membership.productLimit !== null) {
      const current = await this.bulkUploadRepository.countVendorProducts(
        vendor.id,
      );
      if (current + upload.validRows > membership.productLimit) {
        throw new ForbiddenException(
          `Product limit would be exceeded (limit: ${membership.productLimit}, current: ${current}, importing: ${upload.validRows})`,
        );
      }
    }

    await this.bulkUploadRepository.updateUpload(uploadId, {
      status: BulkProductUploadStatus.PROCESSING,
    });

    await this.bulkQueue.add(
      'process-bulk-upload',
      { uploadId, vendorId: vendor.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    );

    return {
      message: 'Upload confirmed and processing started',
      data: { uploadId },
    };
  }

  async adminListUploads(dto: ListBulkUploadsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const [uploads, total] = await Promise.all([
      this.bulkUploadRepository.findAllUploads(page, limit),
      this.bulkUploadRepository.countAllUploads(),
    ]);

    return {
      message: 'Uploads fetched successfully',
      data: uploads,
      meta: paginationMeta(page, limit, total),
    };
  }

  async adminGetUpload(uploadId: string) {
    const upload = await this.bulkUploadRepository.findUploadWithRows(uploadId);
    if (!upload) {
      throw new NotFoundException('Upload not found');
    }
    return { message: 'Upload fetched successfully', data: upload };
  }

  private async validateAndSaveRows(
    uploadId: string,
    vendorId: string,
    csvContent: string,
  ) {
    await this.bulkUploadRepository.updateUpload(uploadId, {
      status: BulkProductUploadStatus.VALIDATING,
    });

    let records: Record<string, string>[];
    try {
      records = parseCsv(csvContent);
    } catch {
      await this.bulkUploadRepository.updateUpload(uploadId, {
        status: BulkProductUploadStatus.FAILED,
        errorMessage: 'Failed to parse CSV file',
      });
      return;
    }

    if (records.length === 0) {
      await this.bulkUploadRepository.updateUpload(uploadId, {
        status: BulkProductUploadStatus.FAILED,
        errorMessage: 'CSV file has no data rows',
      });
      return;
    }

    const seenSkus = new Set<string>();
    const rowsToCreate: Parameters<BulkUploadRepository['createRows']>[0] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNumber = i + 2;

      const errors: string[] = [];

      const name = record['name']?.trim() ?? '';
      const categoryId = record['categoryId']?.trim() ?? '';
      const brandId = record['brandId']?.trim() || null;
      const sku = record['sku']?.trim() ?? '';
      const priceStr = record['price']?.trim() ?? '';
      const sellingPriceStr = record['sellingPrice']?.trim() ?? '';
      const costPriceStr = record['costPrice']?.trim() || null;
      const primaryUnitCode = record['primaryUnitCode']?.trim() ?? '';
      const quantityStr = record['quantity']?.trim() ?? '';

      if (!name) errors.push('name is required');
      if (!categoryId) errors.push('categoryId is required');
      if (!sku) errors.push('sku is required');
      if (!priceStr) errors.push('price is required');
      if (!sellingPriceStr) errors.push('sellingPrice is required');
      if (!primaryUnitCode) errors.push('primaryUnitCode is required');

      let price = new Prisma.Decimal(0);
      let sellingPrice = new Prisma.Decimal(0);
      let costPrice: Prisma.Decimal | null = null;
      let quantity = 0;

      if (priceStr && !errors.includes('price is required')) {
        try {
          price = new Prisma.Decimal(priceStr);
          if (price.lessThan(0)) errors.push('price must be non-negative');
        } catch {
          errors.push('price must be a valid number');
        }
      }

      if (sellingPriceStr && !errors.includes('sellingPrice is required')) {
        try {
          sellingPrice = new Prisma.Decimal(sellingPriceStr);
          if (sellingPrice.lessThanOrEqualTo(0))
            errors.push('sellingPrice must be greater than 0');
          if (!price.isZero() && price.lessThan(sellingPrice))
            errors.push('price must be >= sellingPrice');
        } catch {
          errors.push('sellingPrice must be a valid number');
        }
      }

      if (costPriceStr) {
        try {
          costPrice = new Prisma.Decimal(costPriceStr);
          if (costPrice.lessThan(0))
            errors.push('costPrice must be non-negative');
        } catch {
          errors.push('costPrice must be a valid number');
        }
      }

      if (quantityStr) {
        quantity = parseInt(quantityStr, 10);
        if (isNaN(quantity) || quantity < 0)
          errors.push('quantity must be a non-negative integer');
      }

      if (errors.length === 0) {
        if (categoryId) {
          const cat =
            await this.bulkUploadRepository.findActiveCategoryById(categoryId);
          if (!cat) errors.push(`category ${categoryId} not found or inactive`);
        }

        if (brandId) {
          const brand =
            await this.bulkUploadRepository.findActiveBrandById(brandId);
          if (!brand) errors.push(`brand ${brandId} not found or inactive`);
        }

        if (primaryUnitCode) {
          const unit =
            await this.bulkUploadRepository.findActiveUnitByCode(
              primaryUnitCode,
            );
          if (!unit) {
            errors.push(
              `unit with code "${primaryUnitCode}" not found or inactive`,
            );
          }
        }

        if (sku) {
          if (seenSkus.has(sku)) {
            errors.push(`sku "${sku}" is duplicated within this file`);
          } else {
            const existing =
              await this.bulkUploadRepository.findVariantBySku(sku);
            if (existing) errors.push(`sku "${sku}" already exists`);
            else seenSkus.add(sku);
          }
        }
      }

      const isValid = errors.length === 0;
      rowsToCreate.push({
        uploadId,
        rowNumber,
        status: isValid
          ? BulkProductUploadRowStatus.VALID
          : BulkProductUploadRowStatus.INVALID,
        rawData: record,
        errorMessage: isValid ? null : errors.join('; '),
      });
    }

    await this.bulkUploadRepository.createRows(rowsToCreate);

    const validRows = rowsToCreate.filter(
      (r) => r.status === BulkProductUploadRowStatus.VALID,
    ).length;
    const invalidRows = rowsToCreate.length - validRows;

    await this.bulkUploadRepository.updateUpload(uploadId, {
      status:
        validRows > 0
          ? BulkProductUploadStatus.VALIDATED
          : BulkProductUploadStatus.FAILED,
      totalRows: rowsToCreate.length,
      validRows,
      invalidRows,
      errorMessage: validRows === 0 ? 'No valid rows found in CSV' : null,
    });
  }
}
