import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VariantAttributeDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  attributeId!: string;

  @ApiProperty({ example: '600x600 mm' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class SetAttributesDto {
  @ApiProperty({
    type: [VariantAttributeDto],
    description: 'Upsert these attributes. Empty array clears all.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDto)
  attributes!: VariantAttributeDto[];
}
