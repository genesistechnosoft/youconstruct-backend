import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';
import { VendorPlan } from '../../../../generated/prisma/client.js';

export class UpdateVendorMembershipDto {
  @ApiPropertyOptional({ enum: VendorPlan })
  @IsOptional()
  @IsEnum(VendorPlan)
  plan?: VendorPlan;

  @ApiPropertyOptional({
    example: 500,
    description: '0 means unlimited storage',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  storageLimitMb?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'null means unlimited products',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  productLimit?: number | null;

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
