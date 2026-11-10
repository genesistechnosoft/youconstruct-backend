import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProfessionalOnboardingStatus } from '../../../../generated/prisma/client.js';

export class ProfessionalFiltersDto {
  @ApiPropertyOptional({
    enum: ProfessionalOnboardingStatus,
    example: ProfessionalOnboardingStatus.SUBMITTED,
  })
  @IsOptional()
  @IsEnum(ProfessionalOnboardingStatus)
  status?: ProfessionalOnboardingStatus;

  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @IsOptional()
  @IsString()
  search?: string;

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
