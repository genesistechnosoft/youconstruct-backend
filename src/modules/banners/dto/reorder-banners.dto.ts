import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderBannersDto {
  @ApiProperty({
    type: [String],
    example: [
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    ],
    description: 'All non-deleted banner IDs in the desired order',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
