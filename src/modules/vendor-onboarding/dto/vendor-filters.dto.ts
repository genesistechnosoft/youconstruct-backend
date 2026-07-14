import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { VendorOnboardingStatus } from '../../../../generated/prisma/client.js';

export class VendorFiltersDto {
  @ApiPropertyOptional({
    enum: VendorOnboardingStatus,
    example: VendorOnboardingStatus.SUBMITTED,
  })
  @IsOptional()
  @IsEnum(VendorOnboardingStatus)
  status?: VendorOnboardingStatus;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
