import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateVendorProfileDto {
  @ApiPropertyOptional({ example: 'Lakshmi Tiles' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ example: '12 Market Road' })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiPropertyOptional({ example: 'Chennai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Tamil Nadu' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '600001' })
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ example: 13.0827 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 80.2707 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: '33ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'Premium construction materials supplier.' })
  @IsOptional()
  @IsString()
  bio?: string;
}
