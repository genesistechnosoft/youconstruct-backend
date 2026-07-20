import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ShippingMethodType,
  ShippingUnitType,
} from '../../../../generated/prisma/client.js';

/** Product overrides exclude ORDER_VALUE_BASED (enforced in service). */
export class UpsertProductShippingDto {
  @ApiProperty({
    enum: [
      ShippingMethodType.FLAT,
      ShippingMethodType.FREE,
      ShippingMethodType.DISTANCE_BASED,
      ShippingMethodType.UNIT_BASED,
    ],
  })
  @IsEnum(ShippingMethodType)
  methodType!: ShippingMethodType;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  flatCharge?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  freeAboveOrderValue?: number | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeWithinKm?: number | null;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  chargeBeyondKm?: number | null;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCharge?: number | null;

  @ApiPropertyOptional({ enum: ShippingUnitType })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(ShippingUnitType)
  unitType?: ShippingUnitType | null;
}
