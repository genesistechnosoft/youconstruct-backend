import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum BrowseSortBy {
  CREATED_AT = 'createdAt',
  PRICE = 'price',
}

export enum BrowseSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class BrowseProductsDto {
  @ApiPropertyOptional({
    type: [String],
    isArray: true,
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const ids = (Array.isArray(value) ? value : [value])
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((id) => id.length > 0);
    return ids.length > 0 ? ids : undefined;
  })
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  categoryIds?: string[];

  @ApiPropertyOptional({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ example: 'c1d2e3f4-a5b6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ example: 'marble' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: BrowseSortBy, default: BrowseSortBy.CREATED_AT })
  @IsOptional()
  @IsEnum(BrowseSortBy)
  sortBy: BrowseSortBy = BrowseSortBy.CREATED_AT;

  @ApiPropertyOptional({
    enum: BrowseSortOrder,
    default: BrowseSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(BrowseSortOrder)
  sortOrder: BrowseSortOrder = BrowseSortOrder.DESC;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}
