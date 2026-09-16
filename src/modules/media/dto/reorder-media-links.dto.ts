import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderMediaLinksDto {
  @ApiProperty({
    example: [
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    ],
    type: [String],
    description: 'Gallery media IDs in the desired display order',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  mediaIds!: string[];
}
