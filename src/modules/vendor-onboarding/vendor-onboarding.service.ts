import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KycDocumentType,
  MediaOwnerType,
  UserRole,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { paginationMeta } from '../../common/utils/pagination.util';
import { MediaService } from '../media/media.service';
import { RejectVendorDto } from './dto/reject-vendor.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { UpsertKycDocumentDto } from './dto/upsert-kyc-document.dto';
import { VendorFiltersDto } from './dto/vendor-filters.dto';
import { VendorOnboardingRepository } from './vendor-onboarding.repository';

const REQUIRED_KYC_DOCUMENTS = [
  KycDocumentType.AADHAAR,
  KycDocumentType.PAN,
  KycDocumentType.GST,
] as const;

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
      fileUrl: string | null;
    }[];
  };
};

@Injectable()
export class VendorOnboardingService {
  constructor(
    private readonly vendorOnboardingRepository: VendorOnboardingRepository,
    private readonly mediaService: MediaService,
  ) {}

  async getMyOnboarding(userId: string) {
    const vendor = await this.ensureVendorProfile(userId);
    return {
      message: 'Vendor onboarding fetched successfully',
      data: vendor,
    };
  }

  async updateProfile(userId: string, dto: UpdateVendorProfileDto) {
    const vendor = await this.ensureVendorProfile(userId);
    this.ensureVendorCanEdit(vendor.onboardingStatus);

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
        ...(vendor.onboardingStatus === VendorOnboardingStatus.REJECTED && {
          onboardingStatus: VendorOnboardingStatus.DRAFT,
        }),
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

    const document = await this.vendorOnboardingRepository.upsertKycDocument(
      userId,
      documentType,
      dto,
    );

    if (vendor.onboardingStatus === VendorOnboardingStatus.REJECTED) {
      await this.vendorOnboardingRepository.updateProfile(vendor.id, {
        onboardingStatus: VendorOnboardingStatus.DRAFT,
      });
    }

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

    const media = await this.mediaService.uploadPrivateDocument(
      userId,
      { ownerType: MediaOwnerType.VENDOR, ownerId: vendor.id },
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
        documentNo: dto.documentNo,
      },
    );

    if (vendor.onboardingStatus === VendorOnboardingStatus.REJECTED) {
      await this.vendorOnboardingRepository.updateProfile(vendor.id, {
        onboardingStatus: VendorOnboardingStatus.DRAFT,
      });
    }

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

    this.validateReadyForReview(vendor);

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
      data: vendor,
    };
  }

  async approveVendor(id: string) {
    const vendor = await this.vendorOnboardingRepository.findVendorById(id);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.onboardingStatus !== VendorOnboardingStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted vendors can be approved');
    }

    this.validateReadyForReview(vendor);

    const approved = await this.vendorOnboardingRepository.approveVendor(id);
    return {
      message: 'Vendor approved successfully',
      data: approved,
    };
  }

  async rejectVendor(id: string, dto: RejectVendorDto) {
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

    return {
      message: 'Vendor rejected successfully',
      data: rejected,
    };
  }

  private async ensureVendorProfile(userId: string) {
    const existing =
      await this.vendorOnboardingRepository.findVendorByUserId(userId);
    if (existing) {
      return existing;
    }

    const user = await this.vendorOnboardingRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.VENDOR) {
      throw new ForbiddenException('Vendor account required');
    }

    return this.vendorOnboardingRepository.createDraftVendorProfile(
      user.id,
      user.name,
    );
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

  private validateReadyForReview(vendor: VendorForValidation) {
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
      .map(([field]) => field);

    if (vendor.latitude === null) {
      missingFields.push('latitude');
    }

    if (vendor.longitude === null) {
      missingFields.push('longitude');
    }

    const documentsByType = new Map(
      vendor.user.kycDocuments.map((document) => [
        document.documentType,
        document,
      ]),
    );
    const missingDocuments = REQUIRED_KYC_DOCUMENTS.filter((documentType) => {
      const document = documentsByType.get(documentType);
      return !document || !this.hasText(document.fileUrl);
    });

    if (missingFields.length > 0 || missingDocuments.length > 0) {
      throw new BadRequestException({
        message: 'Vendor onboarding is incomplete',
        details: [
          ...missingFields.map((field) => ({
            field,
            message: `${field} is required`,
          })),
          ...missingDocuments.map((documentType) => ({
            field: `kyc.${documentType}`,
            message: `${documentType} document URL is required`,
          })),
        ],
      });
    }
  }

  private hasText(value: string | null | undefined) {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
