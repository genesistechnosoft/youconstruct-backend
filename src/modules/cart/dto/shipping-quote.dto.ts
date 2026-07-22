import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ShippingQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  addressId!: string;
}
