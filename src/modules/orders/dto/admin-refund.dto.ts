import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Full refund of an order or a single sub-order. No partial amounts. */
export class AdminRefundDto {
  @ApiPropertyOptional({
    description: 'When set, refund only this sub-order (full amount)',
  })
  @IsOptional()
  @IsUUID()
  subOrderId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
