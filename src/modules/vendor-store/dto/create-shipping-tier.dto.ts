import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

export class CreateShippingTierDto {
  @ApiProperty({ example: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderValue!: number;

  @ApiPropertyOptional({
    example: 499,
    nullable: true,
    description: 'null means no upper limit',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxOrderValue?: number | null;

  @ApiProperty({ example: 150 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingCharge!: number;
}
