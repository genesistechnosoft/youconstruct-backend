import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelSubOrderDto {
  @ApiPropertyOptional({
    example: 'Changed my mind',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class VendorCancelSubOrderDto {
  @ApiProperty({
    example: 'Out of stock at warehouse',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class AdminCancelSubOrderDto {
  @ApiProperty({
    example: 'Customer requested cancellation',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
