import { Injectable } from '@nestjs/common';
import {
  BulkProductUploadRowStatus,
  BulkProductUploadStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

const UPLOAD_SELECT = {
  id: true,
  vendorId: true,
  uploadedByUserId: true,
  fileName: true,
  storageKey: true,
  status: true,
  totalRows: true,
  validRows: true,
  invalidRows: true,
  importedRows: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ROW_SELECT = {
  id: true,
  rowNumber: true,
  status: true,
  rawData: true,
  errorMessage: true,
  productId: true,
  variantId: true,
  createdAt: true,
} as const;

@Injectable()
export class BulkUploadRepository {
  constructor(private readonly prisma: PrismaService) {}

  createUpload(data: {
    vendorId: string;
    uploadedByUserId: string;
    fileName: string;
    storageKey: string | null;
  }) {
    return this.prisma.bulkProductUpload.create({
      data: {
        vendorId: data.vendorId,
        uploadedByUserId: data.uploadedByUserId,
        fileName: data.fileName,
        storageKey: data.storageKey,
        status: BulkProductUploadStatus.UPLOADED,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        importedRows: 0,
      },
      select: UPLOAD_SELECT,
    });
  }

  updateUpload(
    id: string,
    data: Partial<{
      status: BulkProductUploadStatus;
      totalRows: number;
      validRows: number;
      invalidRows: number;
      importedRows: number;
      errorMessage: string | null;
    }>,
  ) {
    return this.prisma.bulkProductUpload.update({
      where: { id },
      data,
      select: UPLOAD_SELECT,
    });
  }

  findUploadById(id: string) {
    return this.prisma.bulkProductUpload.findUnique({
      where: { id },
      select: UPLOAD_SELECT,
    });
  }

  findUploadWithRows(id: string) {
    return this.prisma.bulkProductUpload.findUnique({
      where: { id },
      select: {
        ...UPLOAD_SELECT,
        rows: {
          where: { status: BulkProductUploadRowStatus.INVALID },
          take: 50,
          orderBy: { rowNumber: 'asc' },
          select: ROW_SELECT,
        },
      },
    });
  }

  findUploadsByVendor(vendorId: string, page: number, limit: number) {
    const { skip, take } = paginate(page, limit);
    return this.prisma.bulkProductUpload.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: UPLOAD_SELECT,
    });
  }

  countUploadsByVendor(vendorId: string) {
    return this.prisma.bulkProductUpload.count({ where: { vendorId } });
  }

  findAllUploads(page: number, limit: number) {
    const { skip, take } = paginate(page, limit);
    return this.prisma.bulkProductUpload.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: UPLOAD_SELECT,
    });
  }

  countAllUploads() {
    return this.prisma.bulkProductUpload.count();
  }

  createRows(
    rows: Array<{
      uploadId: string;
      rowNumber: number;
      status: BulkProductUploadRowStatus;
      rawData: Prisma.InputJsonObject;
      errorMessage: string | null;
    }>,
  ) {
    return this.prisma.bulkProductUploadRow.createMany({
      data: rows.map((r) => ({
        uploadId: r.uploadId,
        rowNumber: r.rowNumber,
        status: r.status,
        rawData: r.rawData,
        errorMessage: r.errorMessage,
        productId: null,
        variantId: null,
      })),
    });
  }

  findValidRows(uploadId: string) {
    return this.prisma.bulkProductUploadRow.findMany({
      where: { uploadId, status: BulkProductUploadRowStatus.VALID },
      orderBy: { rowNumber: 'asc' },
      select: { id: true, rowNumber: true, rawData: true },
    });
  }

  markRowImported(id: string, productId: string, variantId: string) {
    return this.prisma.bulkProductUploadRow.update({
      where: { id },
      data: {
        status: BulkProductUploadRowStatus.IMPORTED,
        productId,
        variantId,
      },
    });
  }

  markRowFailed(id: string, errorMessage: string) {
    return this.prisma.bulkProductUploadRow.update({
      where: { id },
      data: { status: BulkProductUploadRowStatus.FAILED, errorMessage },
    });
  }

  findActiveCategoryById(categoryId: string) {
    return this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  findActiveBrandById(brandId: string) {
    return this.prisma.brand.findFirst({
      where: { id: brandId, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  findActiveUnitByCode(code: string) {
    return this.prisma.unit.findFirst({
      where: { code, isActive: true },
      select: { id: true, code: true },
    });
  }

  findVariantBySku(sku: string) {
    return this.prisma.productVariant.findFirst({
      where: { sku, deletedAt: null },
      select: { id: true },
    });
  }

  countVendorProducts(vendorId: string) {
    return this.prisma.product.count({
      where: { vendorId, deletedAt: null },
    });
  }

  findVendorMembership(vendorId: string) {
    return this.prisma.vendorMembership.findUnique({
      where: { vendorId },
      select: { productLimit: true, isActive: true },
    });
  }

  findSlugExists(slug: string) {
    return this.prisma.product.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    });
  }

  findVendorByUserId(userId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { userId, isApproved: true, deletedAt: null },
      select: { id: true },
    });
  }

  async createProductWithVariant(data: {
    vendorId: string;
    slug: string;
    categoryId: string;
    brandId: string | null;
    name: string;
    description: string;
    shortDescription: string;
    tags: string[];
    metaTitle: string;
    metaDescription: string;
    sku: string;
    price: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
    costPrice: Prisma.Decimal | null;
    primaryUnitId: string;
    quantity: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          vendorId: data.vendorId,
          categoryId: data.categoryId,
          brandId: data.brandId,
          name: data.name,
          slug: data.slug,
          description: data.description,
          shortDescription: data.shortDescription,
          status: ProductStatus.DRAFT,
          tags: data.tags,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
        },
        select: { id: true },
      });

      const variant = await tx.productVariant.create({
        data: {
          productId: product.id,
          name: data.name,
          sku: data.sku,
          price: data.price,
          sellingPrice: data.sellingPrice,
          costPrice: data.costPrice,
          primaryUnitId: data.primaryUnitId,
          isActive: true,
          isDefault: true,
        },
        select: { id: true },
      });

      await tx.productInventory.create({
        data: {
          variantId: variant.id,
          quantity: data.quantity,
          allowBackorder: false,
        },
      });

      return { productId: product.id, variantId: variant.id };
    });
  }
}
