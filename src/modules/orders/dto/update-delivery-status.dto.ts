import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { DeliveryStatus } from '../../../../generated/prisma/client.js';

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: DeliveryStatus })
  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  courierName?: string;

  @ApiPropertyOptional({ description: 'Required when marking DELIVERED' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  otp?: string;

  @ApiPropertyOptional({ description: 'Required when marking DELIVERED' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  vendorRemarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerRemarks?: string;
}

export class AdminUpdateDeliveryStatusDto extends UpdateDeliveryStatusDto {
  @ApiProperty({ description: 'Required audited override reason' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class DeliveryRemarksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerRemarks?: string;
}
