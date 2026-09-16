import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycDocumentType } from '../../../../generated/prisma/client.js';

export class OnboardingRejectedDocumentDto {
  @ApiProperty({ enum: KycDocumentType })
  documentType!: KycDocumentType;

  @ApiPropertyOptional()
  rejectionNote?: string | null;
}

export class OnboardingChecklistDto {
  @ApiProperty({ enum: KycDocumentType, isArray: true })
  requiredDocuments!: KycDocumentType[];

  @ApiProperty({ type: [String], example: ['bio', 'gstNumber'] })
  missingProfileFields!: string[];

  @ApiProperty({ enum: KycDocumentType, isArray: true })
  missingDocuments!: KycDocumentType[];

  @ApiProperty({ type: [OnboardingRejectedDocumentDto] })
  rejectedDocuments!: OnboardingRejectedDocumentDto[];

  @ApiProperty({ example: false })
  canSubmit!: boolean;
}
