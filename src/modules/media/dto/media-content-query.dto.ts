import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MEDIA_VARIANTS } from '../media.constants';
import type { MediaVariant } from '../media.constants';

export class MediaContentQueryDto {
  @ApiProperty({
    required: false,
    enum: Object.values(MEDIA_VARIANTS),
    default: MEDIA_VARIANTS.ORIGINAL,
  })
  @IsOptional()
  @IsIn(Object.values(MEDIA_VARIANTS))
  variant?: MediaVariant;
}
