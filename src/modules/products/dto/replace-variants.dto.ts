import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VariantAttributeDto } from './set-attributes.dto';

export class BulkVariantInventoryDto {
  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowBackorder?: boolean;
}

export class BulkVariantDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ example: 'tmp_7' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientKey?: string;

  @ApiProperty({ example: 'TILE-600' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiPropertyOptional({ example: '600x600 / Red', nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiProperty({ example: 1200 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiProperty({ example: 999 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice!: number;

  @ApiPropertyOptional({ example: 750, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number | null;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  primaryUnitId!: string;

  @ApiPropertyOptional({ example: 15.5, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  coverageArea?: number | null;

  @ApiPropertyOptional({
    example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  baseUnitId?: string | null;

  @ApiPropertyOptional({ example: 22, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [VariantAttributeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDto)
  attributes!: VariantAttributeDto[];

  @ApiPropertyOptional({ type: BulkVariantInventoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkVariantInventoryDto)
  inventory?: BulkVariantInventoryDto;
}

export class ReplaceVariantsDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ type: [BulkVariantDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkVariantDto)
  variants!: BulkVariantDto[];
}

export class DryRunQueryDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}
