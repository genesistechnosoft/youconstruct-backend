import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnReasonCode } from '../../../../generated/prisma/client.js';

export class CreateReturnItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deliveryItemId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateReturnRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deliveryId!: string;

  @ApiProperty({ enum: ReturnReasonCode })
  @IsEnum(ReturnReasonCode)
  reasonCode!: ReturnReasonCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;

  @ApiProperty({ type: [CreateReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mediaIds?: string[];
}

export class ReviewReturnDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AdminOverrideReturnDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class ConfirmReturnReceiptDto {
  @ApiPropertyOptional({ description: 'Required unless admin override' })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  inspectionNotes?: string;

  @ApiPropertyOptional({ description: 'Admin override reason' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ConfirmOfflineRefundDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(6)
  otp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
