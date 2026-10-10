import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PreferredPaymentMethod } from '../../../../generated/prisma/client.js';

export class UpdateStoreSettingsDto {
  @ApiPropertyOptional({
    example:
      'Family-run tile yard supplying contractors across Chennai since 1998.',
    maxLength: 2000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingPolicy?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refundPolicy?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cancellationPolicy?: string | null;

  @ApiPropertyOptional({ enum: PreferredPaymentMethod })
  @IsOptional()
  @IsEnum(PreferredPaymentMethod)
  preferredPaymentMethod?: PreferredPaymentMethod | null;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  supportPhone?: string | null;

  @ApiPropertyOptional({ example: 'support@store.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  supportEmail?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  supportAddressLine1?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  supportAddressLine2?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supportCity?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  supportState?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  supportPincode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  seoTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seoDescription?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seoKeywords?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ogTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ogDescription?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  twitterTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  twitterDescription?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialInstagram?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialFacebook?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialTwitter?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialYoutube?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialLinkedin?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  socialPinterest?: string | null;
}
