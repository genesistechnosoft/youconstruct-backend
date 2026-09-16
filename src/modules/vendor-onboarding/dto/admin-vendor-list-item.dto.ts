import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  KycDocumentType,
  KycStatus,
  VendorOnboardingStatus,
  VendorPlan,
} from '../../../../generated/prisma/client.js';

export class AdminVendorListKycDto {
  @ApiProperty({ enum: KycDocumentType })
  documentType!: KycDocumentType;

  @ApiProperty({ enum: KycStatus })
  status!: KycStatus;
}

export class AdminVendorListUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  email?: string | null;

  @ApiPropertyOptional()
  phone?: string | null;

  @ApiProperty({ type: [AdminVendorListKycDto] })
  kycDocuments!: AdminVendorListKycDto[];
}

export class AdminVendorListMembershipDto {
  @ApiProperty({ enum: VendorPlan })
  plan!: VendorPlan;

  @ApiProperty()
  isActive!: boolean;
}

export class AdminVendorListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  businessName!: string;

  @ApiPropertyOptional()
  slug?: string | null;

  @ApiPropertyOptional()
  city?: string | null;

  @ApiPropertyOptional()
  state?: string | null;

  @ApiPropertyOptional()
  gstNumber?: string | null;

  @ApiProperty()
  isApproved!: boolean;

  @ApiProperty({ enum: VendorOnboardingStatus })
  onboardingStatus!: VendorOnboardingStatus;

  @ApiPropertyOptional()
  submittedAt?: Date | null;

  @ApiPropertyOptional()
  reviewedAt?: Date | null;

  @ApiPropertyOptional()
  rejectionReason?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: AdminVendorListUserDto })
  user!: AdminVendorListUserDto;

  @ApiPropertyOptional({ type: AdminVendorListMembershipDto, nullable: true })
  membership?: AdminVendorListMembershipDto | null;
}
