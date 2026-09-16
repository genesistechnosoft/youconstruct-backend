import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PRODUCT_TAG_MAX_COUNT,
  PRODUCT_TAG_MAX_LENGTH,
} from '../product-tags.util';

export class CreateProductDto {
  @ApiProperty({ example: 'Italian Marble Tile' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ example: 'b1c2d3e4-f5a6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiProperty({ example: 'Premium marble tile for flooring and walls' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 'Premium marble tile' })
  @IsString()
  @IsNotEmpty()
  shortDescription!: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isReturnable?: boolean;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  returnWindowDays?: number;

  @ApiPropertyOptional({ example: ['marble', 'flooring'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_TAG_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(PRODUCT_TAG_MAX_LENGTH, { each: true })
  tags?: string[];

  @ApiProperty({ example: 'Italian Marble Tile | YouConstruct' })
  @IsString()
  @IsNotEmpty()
  metaTitle!: string;

  @ApiProperty({ example: 'Buy premium Italian marble tiles online.' })
  @IsString()
  @IsNotEmpty()
  metaDescription!: string;
}
