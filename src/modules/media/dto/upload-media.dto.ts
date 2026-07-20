import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { MediaAccessLevel } from '../../../../generated/prisma/client.js';

const LIBRARY_ACCESS_LEVELS = [
  MediaAccessLevel.PUBLIC,
  MediaAccessLevel.SIGNED,
] as const;

export class UploadMediaDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({
    enum: LIBRARY_ACCESS_LEVELS,
    default: MediaAccessLevel.PUBLIC,
    description:
      'Vendor media library allows PUBLIC or SIGNED only (not PRIVATE)',
  })
  @IsOptional()
  @IsEnum(MediaAccessLevel)
  @IsIn(LIBRARY_ACCESS_LEVELS)
  accessLevel?: (typeof LIBRARY_ACCESS_LEVELS)[number];
}
