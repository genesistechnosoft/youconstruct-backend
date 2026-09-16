import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MediaFileType } from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum MediaSortBy {
  CREATED_AT = 'createdAt',
  FILE_NAME = 'fileName',
  SIZE_BYTES = 'sizeBytes',
}

export enum MediaSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class FolderContentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MediaFileType })
  @IsOptional()
  @IsEnum(MediaFileType)
  fileType?: MediaFileType;

  @ApiPropertyOptional({ example: 'marble' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: MediaSortBy,
    default: MediaSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(MediaSortBy)
  sortBy: MediaSortBy = MediaSortBy.CREATED_AT;

  @ApiPropertyOptional({
    enum: MediaSortOrder,
    default: MediaSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(MediaSortOrder)
  sortOrder: MediaSortOrder = MediaSortOrder.DESC;
}
