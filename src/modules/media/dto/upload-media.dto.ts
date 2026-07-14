import { ApiProperty } from '@nestjs/swagger';
import { MediaVisibility } from '../../../../generated/prisma/client.js';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadMediaDto {
  @ApiProperty({ enum: MediaVisibility })
  @IsEnum(MediaVisibility)
  visibility!: MediaVisibility;

  @ApiProperty({
    required: false,
    description: 'Optional JSON string with client metadata hints',
  })
  @IsOptional()
  @IsString()
  metadata?: string;
}
