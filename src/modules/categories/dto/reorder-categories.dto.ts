import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class ReorderCategoriesDto {
  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Null or omit to reorder roots',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    type: [String],
    example: [
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
