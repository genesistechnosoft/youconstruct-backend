import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  DeliveryCancelResolution,
  DeliveryStatus,
} from '../../../../generated/prisma/client.js';

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

  @ApiPropertyOptional({
    enum: DeliveryCancelResolution,
    description: 'Required when status is CANCELLED',
  })
  @IsOptional()
  @IsEnum(DeliveryCancelResolution)
  resolution?: DeliveryCancelResolution;

  @ApiPropertyOptional({
    description:
      'Required for every admin status change, and for a vendor when status is CANCELLED',
  })
  @ValidateIf(
    (dto: UpdateDeliveryStatusDto) =>
      dto.constructor.name === 'AdminUpdateDeliveryStatusDto' ||
      dto.status === DeliveryStatus.CANCELLED,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason?: string;
}

export class AdminUpdateDeliveryStatusDto extends UpdateDeliveryStatusDto {}

export class DeliveryRemarksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerRemarks?: string;
}
