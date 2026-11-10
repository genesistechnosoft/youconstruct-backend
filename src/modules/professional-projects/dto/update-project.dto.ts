import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BudgetRange } from '../../../../generated/prisma/client.js';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Luxury Villa Interior — Whitefield' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ example: 'A complete turnkey interior...' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 'Whitefield, Bangalore' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @ApiPropertyOptional({ example: 2200 })
  @IsOptional()
  @Type(() => Number)
  areaSqft?: number;

  @ApiPropertyOptional({ enum: BudgetRange })
  @IsOptional()
  @IsEnum(BudgetRange)
  budgetRange?: BudgetRange;

  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  completionYear?: number;
}
