import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '../../../../generated/prisma/client.js';

export class CheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  addressId!: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ example: 'SAVE10', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;
}
