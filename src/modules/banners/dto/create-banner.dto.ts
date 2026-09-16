import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBannerDto {
  @ApiProperty({ example: 'Monsoon Sale' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'Up to 40% off on tiles' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'https://youconstruct.com/sale' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  targetUrl?: string;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const n = Number(value);
    return isNaN(n) ? value : n;
  })
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-07-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
