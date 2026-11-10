import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProfessionalContentStatus } from '../../../../generated/prisma/client.js';

export class ProjectFiltersDto {
  @ApiPropertyOptional({ enum: ProfessionalContentStatus })
  @IsOptional()
  @IsEnum(ProfessionalContentStatus)
  status?: ProfessionalContentStatus;

  @ApiPropertyOptional({ example: 'Villa' })
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
