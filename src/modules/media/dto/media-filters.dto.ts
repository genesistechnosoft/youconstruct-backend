import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MediaFileType } from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class MediaFiltersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MediaFileType })
  @IsOptional()
  @IsEnum(MediaFileType)
  fileType?: MediaFileType;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
