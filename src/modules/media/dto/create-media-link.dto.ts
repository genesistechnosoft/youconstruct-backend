import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMediaLinkDto {
  @ApiProperty({ example: 'PRODUCT' })
  @IsString()
  @MaxLength(80)
  entityType!: string;

  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiProperty({ required: false, example: 'gallery' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  context?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
