import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BudgetRange } from '../../../../generated/prisma/client.js';

export class CreateProjectDto {
  @ApiProperty({
    example: 'Modern 3BHK Interior — Koramangala',
    maxLength: 150,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional({
    example: 'A complete turnkey interior for a 1400 sqft 3BHK apartment...',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 'Koramangala, Bangalore', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @ApiPropertyOptional({ example: 1400, description: 'Project area in sq ft' })
  @IsOptional()
  @Type(() => Number)
  areaSqft?: number;

  @ApiPropertyOptional({ enum: BudgetRange })
  @IsOptional()
  @IsEnum(BudgetRange)
  budgetRange?: BudgetRange;

  @ApiPropertyOptional({ example: 2023, minimum: 1950, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  completionYear?: number;
}
