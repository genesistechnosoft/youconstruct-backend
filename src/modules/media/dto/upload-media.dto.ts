import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MediaAccessLevel } from '../../../../generated/prisma/client.js';

export class UploadMediaDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({
    enum: MediaAccessLevel,
    default: MediaAccessLevel.PUBLIC,
  })
  @IsOptional()
  @IsEnum(MediaAccessLevel)
  accessLevel?: MediaAccessLevel;
}
