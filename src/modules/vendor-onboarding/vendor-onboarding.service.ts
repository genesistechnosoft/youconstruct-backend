import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KycDocumentType,
  KycStatus,
  MediaOwnerType,
  NotificationEventType,
  PlatformRole,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginationMeta } from '../../common/utils/pagination.util';
import { generateSlug } from '../../common/utils/slug.util';
import { MediaService } from '../media/media.service';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { OnboardingChecklistDto } from './dto/onboarding-checklist.dto';
import { RejectKycDocumentDto } from './dto/reject-kyc-document.dto';
import { RejectVendorDto } from './dto/reject-vendor.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { UpsertKycDocumentDto } from './dto/upsert-kyc-document.dto';
import { VendorFiltersDto } from './dto/vendor-filters.dto';
import { GSTIN_PATTERN } from './vendor-onboarding.constants.js';
import { VendorOnboardingRepository } from './vendor-onboarding.repository';

const KYC_DOCUMENT_TYPES = new Set<string>(Object.values(KycDocumentType));

type VendorForValidation = {
  businessName: string;
  businessAddress: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  gstNumber: string | null;
  bio: string | null;
  user: {
    kycDocuments: {
      documentType: KycDocumentType;
      documentNo: string | null;
      fileUrl: string | null;
      status: KycStatus;
      rejectionNote: string | null;
    }[];
  };
};

@Injectable()
export class VendorOnboardingService {
  constructor(
    private readonly vendorOnboardingRepository: VendorOnboardingRepository,
    private readonly mediaService: MediaService,
    private readonly securityAudit: SecurityAuditService,
    private readonly notifications: NotificationEmitterService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async getMyOnboarding(userId: string) {
    const vendor = await this.ensureVendorProfile(userId);
    return {
      message: 'Vendor onboarding fetched successfully',
      data: await this.withChecklist(await this.withFreshKycUrls(vendor)),
    };
  }

  async updateProfile(userId: string, dto: UpdateVendorProfileDto) {
    const vendor = await this.ensureVendorProfile(userId);
    this.ensureVendorCanEdit(vendor.onboardingStatus);

    if (dto.gstNumber !== undefined) {
      const nextGst = this.normalizeGstin(dto.gstNumber);
      const currentGst = this.hasText(vendor.gstNumber)
        ? this.normalizeGstin(vendor.gstNumber)
        : '';

      if (nextGst !== currentGst) {
        await this.ensureGstNumberAvailable(nextGst, vendor.id);
        await this.resetGstKycIfNumberChanged(vendor, nextGst);
      }
    }

    const updated = await this.vendorOnboardingRepository.updateProfile(
      vendor.id,
      {
        ...(dto.businessName !== undefined && {
          businessName: dto.businessName,
        }),
        ...(dto.businessAddress !== undefined && {
          businessAddress: dto.businessAddress,
        }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.state !== undefined && { state: dto.state }),
        ...(dto.pincode !== undefined && { pincode: dto.pincode }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        ...(dto.gstNumber !== undefined && { gstNumber: dto.gstNumber }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.about !== undefined && {
          about: this.normalizeAbout(dto.about),
        }),
        ...(!vendor.slug
          ? {
              slug: await this.allocateUniqueSlug(
                dto.businessName ?? vendor.businessName,
              ),
            }
          : {}),
      },
    );

    return {
      message: 'Vendor profile updated successfully',
      data: updated,
    };
  }

  async upsertKycDocument(
    userId: string,
    documentType: KycDocumentType,
    dto: UpsertKycDocumentDto,
  ) {
    const vendor = await this.ensureVendorProfile(userId);
    this.ensureVendorCanEdit(vendor.onboardingStatus);
    const documentNo = this.resolveGstDocumentNo(
      documentType,
      dto.documentNo,
      vendor.gstNumber,
    );
    this.ensureGstKycMatchesProfile(documentType, documentNo, vendor);

    const document = await this.vendorOnboardingRepository.upsertKycDocument(
      userId,
      documentType,
      {
        ...dto,
        ...(documentNo !== undefined ? { documentNo } : {}),
      },
    );

    return {
      message: 'KYC document saved successfully',
      data: document,
    };
  }

  async uploadKycDocument(
    userId: string,
    documentType: KycDocumentType,
    file: Express.Multer.File | undefined,
    dto: UploadKycDocumentDto,
  ) {
    const vendor = await this.ensureVendorProfile(userId);
    this.ensureVendorCanEdit(vendor.onboardingStatus);
    const documentNo = this.resolveGstDocumentNo(
      documentType,
      dto.documentNo,
      vendor.gstNumber,
    );
    this.ensureGstKycMatchesProfile(documentType, documentNo, vendor);

    const media = await this.mediaService.uploadPrivateDocument(
      userId,
      { ownerType: MediaOwnerType.USER, ownerId: userId },
      file,
      `kyc/${userId}/${documentType}`,
    );
    const mediaWithUrls = await this.mediaService.withUrls(media);
    const document = await this.vendorOnboardingRepository.upsertKycDocument(
      userId,
      documentType,
      {
        fileUrl: mediaWithUrls.originalUrl,
        mediaId: media.id,
        documentNo,
      },
    );

    return {
      message: 'KYC document uploaded successfully',
      data: document,
    };
  }

  async submitForReview(userId: string) {
    const vendor = await this.ensureVendorProfile(userId);

    if (vendor.onboardingStatus === VendorOnboardingStatus.SUBMITTED) {
      throw new BadRequestException('Vendor onboarding is already submitted');
    }

    if (vendor.onboardingStatus === VendorOnboardingStatus.APPROVED) {
      throw new BadRequestException('Vendor is already approved');
    }

    const requiredDocs = await this.getRequiredKycDocuments();
    this.validateReadyForSubmit(vendor, requiredDocs);
    if (vendor.gstNumber) {
      await this.ensureGstNumberAvailable(vendor.gstNumber, vendor.id);
    }

    const submitted = await this.vendorOnboardingRepository.submitVendor(
      vendor.id,
    );

    return {
      message: 'Vendor onboarding submitted for review',
      data: submitted,
    };
  }

  async getVendors(filters: VendorFiltersDto) {
    const { items, total } =
      await this.vendorOnboardingRepository.findVendors(filters);

    return {
      message: 'Vendors fetched successfully',
      data: items,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async getVendor(id: string) {
    const vendor = await this.vendorOnboardingRepository.findVendorById(id);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return {
      message: 'Vendor fetched successfully',
      data: await this.withChecklist(await this.withFreshKycUrls(vendor)),
    };
  }

  async verifyKycDocument(
    vendorId: string,
    documentType: KycDocumentType,
    actorUserId: string,
  ) {
    const vendor =
      await this.vendorOnboardingRepository.findVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const document = await this.vendorOnboardingRepository.findKycDocument(
      vendor.userId,
      documentType,
    );
    if (!document || !this.hasText(document.fileUrl)) {
      throw new NotFoundException('KYC document not found');
    }

    if (document.status === KycStatus.VERIFIED) {
      throw new BadRequestException('KYC document is already verified');
    }

    const updated =
      await this.vendorOnboardingRepository.updateKycDocumentStatus(
        vendor.userId,
        documentType,
        { status: KycStatus.VERIFIED, rejectionNote: null },
      );

    this.securityAudit.log({
      actorUserId,
      action: 'KYC_DOC_VERIFY',
      result: 'SUCCESS',
      targetType: 'kycDocument',
      targetId: document.id,
      metadata: { vendorId, documentType },
    });
    this.notifications.emit({
      userId: vendor.userId,
      eventType: NotificationEventType.KYC_APPROVED,
      title: 'KYC document verified',
      body: `Your ${documentType} document has been verified`,
      data: { vendorId, documentType },
    });

    const autoApproved = await this.maybeAutoApproveVendor(
      vendorId,
      actorUserId,
    );

    return {
      message: 'KYC document verified successfully',
      data: {
        document: updated,
        vendorAutoApproved: autoApproved,
      },
    };
  }

  async rejectKycDocument(
    vendorId: string,
    documentType: KycDocumentType,
    actorUserId: string,
    dto: RejectKycDocumentDto,
  ) {
    const vendor =
      await this.vendorOnboardingRepository.findVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const document = await this.vendorOnboardingRepository.findKycDocument(
      vendor.userId,
      documentType,
    );
    if (!document || !this.hasText(document.fileUrl)) {
      throw new NotFoundException('KYC document not found');
    }

    const updated =
      await this.vendorOnboardingRepository.updateKycDocumentStatus(
        vendor.userId,
        documentType,
        { status: KycStatus.REJECTED, rejectionNote: dto.rejectionNote },
      );

    if (vendor.onboardingStatus === VendorOnboardingStatus.SUBMITTED) {
      await this.vendorOnboardingRepository.rejectVendor(
        vendor.id,
        `${documentType}: ${dto.rejectionNote}`,
      );
    }

    this.securityAudit.log({
      actorUserId,
      action: 'KYC_DOC_REJECT',
      result: 'SUCCESS',
      targetType: 'kycDocument',
      targetId: document.id,
      metadata: { vendorId, documentType, reason: dto.rejectionNote },
    });
    this.notifications.emit({
      userId: vendor.userId,
      eventType: NotificationEventType.KYC_REJECTED,
      title: 'KYC document rejected',
      body: dto.rejectionNote,
      data: { vendorId, documentType },
    });

    return {
      message: 'KYC document rejected successfully',
      data: updated,
    };
  }

  async approveVendor(id: string, actorUserId: string) {
    const vendor = await this.vendorOnboardingRepository.findVendorById(id);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.onboardingStatus === VendorOnboardingStatus.APPROVED) {
      return {
        message: 'Vendor is already approved',
        data: vendor,
      };
    }

    const requiredDocs = await this.getRequiredKycDocuments();
    this.validateReadyForAdminApprove(vendor, requiredDocs);
    if (vendor.gstNumber) {
      await this.ensureGstNumberAvailable(vendor.gstNumber, vendor.id);
    }
    await this.ensureVendorHasSlug(vendor);

    const approved = await this.vendorOnboardingRepository.approveVendor(
      id,
      vendor.userId,
      requiredDocs,
    );
    this.securityAudit.log({
      actorUserId,
      action: 'VENDOR_APPROVE',
      result: 'SUCCESS',
      targetType: 'vendorProfile',
      targetId: id,
    });
    this.notifications.emit({
      userId: vendor.userId,
      eventType: NotificationEventType.KYC_APPROVED,
      title: 'Vendor approved',
      body: 'Your vendor onboarding has been approved',
      data: { vendorId: id },
    });
    return {
      message: 'Vendor approved successfully',
      data: approved,
    };
  }

  async rejectVendor(id: string, actorUserId: string, dto: RejectVendorDto) {
    const vendor = await this.vendorOnboardingRepository.findVendorById(id);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.onboardingStatus !== VendorOnboardingStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted vendors can be rejected');
    }

    const rejected = await this.vendorOnboardingRepository.rejectVendor(
      id,
      dto.rejectionReason,
    );
    this.securityAudit.log({
      actorUserId,
      action: 'VENDOR_REJECT',
      result: 'SUCCESS',
      targetType: 'vendorProfile',
      targetId: id,
      metadata: { reason: dto.rejectionReason },
    });
    this.notifications.emit({
      userId: vendor.userId,
      eventType: NotificationEventType.KYC_REJECTED,
      title: 'Vendor rejected',
      body: dto.rejectionReason,
      data: { vendorId: id },
    });

    return {
      message: 'Vendor rejected successfully',
      data: rejected,
    };
  }

  private async maybeAutoApproveVendor(
    vendorId: string,
    actorUserId: string,
  ): Promise<boolean> {
    const autoApprove = await this.platformSettings.getBoolean(
      'vendor',
      'autoApproveAfterRequiredDocsVerified',
    );
    if (!autoApprove) {
      return false;
    }

    const vendor =
      await this.vendorOnboardingRepository.findVendorById(vendorId);
    if (
      !vendor ||
      vendor.onboardingStatus !== VendorOnboardingStatus.SUBMITTED
    ) {
      return false;
    }

    const requiredDocs = await this.getRequiredKycDocuments();
    const allVerified = this.areRequiredDocsVerified(vendor, requiredDocs);
    if (!allVerified) {
      return false;
    }

    await this.approveVendor(vendorId, actorUserId);
    return true;
  }

  private async ensureVendorProfile(userId: string) {
    const existing =
      await this.vendorOnboardingRepository.findVendorByUserId(userId);
    if (existing) {
      if (!existing.slug) {
        const slug = await this.allocateUniqueSlug(existing.businessName);
        return this.vendorOnboardingRepository.updateProfile(existing.id, {
          slug,
        });
      }
      return existing;
    }

    const user = await this.vendorOnboardingRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.platformRole !== PlatformRole.VENDOR) {
      throw new ForbiddenException('Vendor account required');
    }

    const hasMembership =
      await this.vendorOnboardingRepository.hasTeamMembership(userId);
    if (hasMembership) {
      throw new ForbiddenException(
        'Only store owners can complete vendor onboarding',
      );
    }

    const slug = await this.allocateUniqueSlug(user.name);
    return this.vendorOnboardingRepository.createDraftVendorProfile(
      user.id,
      user.name,
      slug,
    );
  }

  private async allocateUniqueSlug(businessName: string) {
    const base = generateSlug(businessName) || 'vendor';
    let candidate = base;
    let suffix = 2;

    while (await this.vendorOnboardingRepository.findBySlug(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private async ensureVendorHasSlug(vendor: {
    id: string;
    slug: string | null;
    businessName: string;
  }) {
    if (vendor.slug) {
      return;
    }

    const slug = await this.allocateUniqueSlug(vendor.businessName);
    await this.vendorOnboardingRepository.updateProfile(vendor.id, { slug });
  }

  private async getRequiredKycDocuments(): Promise<KycDocumentType[]> {
    const value = await this.platformSettings.getValue(
      'vendor',
      'requiredKycDocuments',
    );
    const raw = Array.isArray(value) ? value : [];
    const docs = raw
      .filter((item): item is string => typeof item === 'string')
      .filter((item) => KYC_DOCUMENT_TYPES.has(item))
      .map((item) => item as KycDocumentType);

    if (docs.length === 0) {
      return [
        KycDocumentType.AADHAAR,
        KycDocumentType.PAN,
        KycDocumentType.GST,
      ];
    }

    return docs;
  }

  private async withFreshKycUrls<
    T extends {
      user: {
        kycDocuments: {
          mediaId: string | null;
          userId: string;
          fileUrl: string | null;
        }[];
      };
    },
  >(vendor: T): Promise<T> {
    const kycDocuments = await Promise.all(
      vendor.user.kycDocuments.map(async (document) => {
        if (!document.mediaId) {
          return document;
        }

        try {
          const fileUrl = await this.mediaService.getPrivateUserDocumentUrl(
            document.mediaId,
            document.userId,
          );
          return { ...document, fileUrl };
        } catch {
          return document;
        }
      }),
    );

    return {
      ...vendor,
      user: {
        ...vendor.user,
        kycDocuments,
      },
    };
  }

  private async withChecklist<T extends VendorForValidation>(vendor: T) {
    const requiredDocuments = await this.getRequiredKycDocuments();
    return {
      ...vendor,
      checklist: this.buildChecklist(vendor, requiredDocuments),
    };
  }

  private buildChecklist(
    vendor: VendorForValidation,
    requiredDocuments: KycDocumentType[],
  ): OnboardingChecklistDto {
    const gaps = this.collectOnboardingGaps(vendor, requiredDocuments);
    return {
      requiredDocuments,
      missingProfileFields: gaps.missingProfileFields,
      missingDocuments: gaps.missingDocuments,
      rejectedDocuments: gaps.rejectedDocuments,
      canSubmit: gaps.canSubmit,
    };
  }

  private ensureVendorCanEdit(status: VendorOnboardingStatus) {
    if (status === VendorOnboardingStatus.SUBMITTED) {
      throw new BadRequestException(
        'Submitted onboarding cannot be edited until reviewed',
      );
    }

    if (status === VendorOnboardingStatus.APPROVED) {
      throw new BadRequestException('Approved vendor profile cannot be edited');
    }
  }

  private validateReadyForSubmit(
    vendor: VendorForValidation,
    requiredDocs: KycDocumentType[],
  ) {
    const gaps = this.collectOnboardingGaps(vendor, requiredDocs);
    const details = [
      ...gaps.missingProfileFields.map((field) => ({
        field,
        message:
          field === 'gstNumber' && this.hasText(vendor.gstNumber)
            ? 'gstNumber must be a valid 15-character GSTIN'
            : `${field} is required`,
      })),
      ...gaps.missingDocuments.map((documentType) => ({
        field: `kyc.${documentType}`,
        message: `${documentType} document URL is required`,
      })),
      ...gaps.rejectedDocuments.map((document) => ({
        field: `kyc.${document.documentType}`,
        message: `${document.documentType} document was rejected and must be re-uploaded`,
      })),
      ...(gaps.gstMismatch
        ? [
            {
              field: 'gstNumber',
              message: 'gstNumber must match GST KYC document number',
            },
          ]
        : []),
    ];

    if (details.length > 0) {
      throw new BadRequestException({
        message: 'Vendor onboarding is incomplete',
        details,
      });
    }
  }

  private collectOnboardingGaps(
    vendor: VendorForValidation,
    requiredDocs: KycDocumentType[],
  ) {
    const missingProfileFields = this.collectMissingProfileFields(vendor);
    const documentsByType = new Map(
      vendor.user.kycDocuments.map((document) => [
        document.documentType,
        document,
      ]),
    );
    const missingDocuments = requiredDocs.filter((documentType) => {
      const document = documentsByType.get(documentType);
      return !document || !this.hasText(document.fileUrl);
    });
    const rejectedDocuments = requiredDocs.flatMap((documentType) => {
      const document = documentsByType.get(documentType);
      if (
        !document ||
        !this.hasText(document.fileUrl) ||
        document.status !== KycStatus.REJECTED
      ) {
        return [];
      }

      return [
        {
          documentType,
          rejectionNote: document.rejectionNote,
        },
      ];
    });

    if (
      this.hasText(vendor.gstNumber) &&
      !this.isValidGstin(vendor.gstNumber) &&
      !missingProfileFields.includes('gstNumber')
    ) {
      missingProfileFields.push('gstNumber');
    }

    const gstKycNo = documentsByType.get(KycDocumentType.GST)?.documentNo;
    const gstMismatch =
      this.hasText(vendor.gstNumber) &&
      this.hasText(gstKycNo) &&
      this.normalizeGstin(vendor.gstNumber) !== this.normalizeGstin(gstKycNo);

    return {
      missingProfileFields,
      missingDocuments,
      rejectedDocuments,
      gstMismatch,
      canSubmit:
        missingProfileFields.length === 0 &&
        missingDocuments.length === 0 &&
        rejectedDocuments.length === 0 &&
        !gstMismatch,
    };
  }

  private validateReadyForAdminApprove(
    vendor: VendorForValidation,
    requiredDocs: KycDocumentType[],
  ) {
    const gaps = this.collectOnboardingGaps(vendor, requiredDocs);
    const details = [
      ...gaps.missingProfileFields.map((field) => ({
        field,
        message:
          field === 'gstNumber' && this.hasText(vendor.gstNumber)
            ? 'gstNumber must be a valid 15-character GSTIN'
            : `${field} is required`,
      })),
      ...gaps.missingDocuments.map((documentType) => ({
        field: `kyc.${documentType}`,
        message: `${documentType} document URL is required`,
      })),
      ...(gaps.gstMismatch
        ? [
            {
              field: 'gstNumber',
              message: 'gstNumber must match GST KYC document number',
            },
          ]
        : []),
    ];

    if (details.length > 0) {
      throw new BadRequestException({
        message: 'Vendor onboarding is incomplete',
        details,
      });
    }
  }

  private areRequiredDocsVerified(
    vendor: VendorForValidation,
    requiredDocs: KycDocumentType[],
  ) {
    const documentsByType = new Map(
      vendor.user.kycDocuments.map((document) => [
        document.documentType,
        document,
      ]),
    );

    return requiredDocs.every((documentType) => {
      const document = documentsByType.get(documentType);
      return (
        document &&
        this.hasText(document.fileUrl) &&
        document.status === KycStatus.VERIFIED
      );
    });
  }

  private collectMissingProfileFields(vendor: VendorForValidation) {
    const missingFields = [
      ['businessName', vendor.businessName],
      ['businessAddress', vendor.businessAddress],
      ['city', vendor.city],
      ['state', vendor.state],
      ['pincode', vendor.pincode],
      ['gstNumber', vendor.gstNumber],
      ['bio', vendor.bio],
    ]
      .filter(([, value]) => !this.hasText(value))
      .map(([field]) => field as string);

    if (vendor.latitude === null) {
      missingFields.push('latitude');
    }

    if (vendor.longitude === null) {
      missingFields.push('longitude');
    }

    return missingFields;
  }

  private normalizeAbout(value: string | null): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private hasText(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private normalizeGstin(value: string) {
    return value.trim().toUpperCase();
  }

  private isValidGstin(value: string) {
    return GSTIN_PATTERN.test(this.normalizeGstin(value));
  }

  private async ensureGstNumberAvailable(gstNumber: string, vendorId: string) {
    const existing = await this.vendorOnboardingRepository.findByGstNumber(
      this.normalizeGstin(gstNumber),
      vendorId,
    );
    if (existing) {
      throw new ConflictException('GST number is already registered');
    }
  }

  private async resetGstKycIfNumberChanged(
    vendor: VendorForValidation & { userId: string },
    nextGst: string,
  ) {
    const gstDocument = vendor.user.kycDocuments.find(
      (document) => document.documentType === KycDocumentType.GST,
    );
    if (!gstDocument || !this.hasText(gstDocument.documentNo)) {
      return;
    }

    if (this.normalizeGstin(gstDocument.documentNo) === nextGst) {
      return;
    }

    await this.vendorOnboardingRepository.updateKycDocumentStatus(
      vendor.userId,
      KycDocumentType.GST,
      { status: KycStatus.SUBMITTED, rejectionNote: null },
    );
  }

  private resolveGstDocumentNo(
    documentType: KycDocumentType,
    documentNo: string | undefined,
    gstNumber: string | null,
  ) {
    if (documentType !== KycDocumentType.GST) {
      return documentNo;
    }

    if (this.hasText(documentNo)) {
      return this.normalizeGstin(documentNo);
    }

    if (this.hasText(gstNumber)) {
      return this.normalizeGstin(gstNumber);
    }

    return documentNo;
  }

  private ensureGstKycMatchesProfile(
    documentType: KycDocumentType,
    documentNo: string | undefined,
    vendor: { gstNumber: string | null },
  ) {
    if (documentType !== KycDocumentType.GST || !this.hasText(documentNo)) {
      return;
    }

    if (!this.hasText(vendor.gstNumber)) {
      throw new BadRequestException(
        'Save gstNumber on the store profile before uploading the GST document',
      );
    }

    if (
      this.normalizeGstin(documentNo) !== this.normalizeGstin(vendor.gstNumber)
    ) {
      throw new BadRequestException(
        'GST document number must match the gstNumber saved on the store profile',
      );
    }
  }
}
