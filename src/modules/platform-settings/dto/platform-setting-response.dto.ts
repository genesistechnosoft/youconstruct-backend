import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformSettingValueType } from '../../../../generated/prisma/client.js';

export class PlatformSettingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  namespace!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  value!: unknown;

  @ApiProperty({ enum: PlatformSettingValueType })
  valueType!: PlatformSettingValueType;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  isEditable!: boolean;

  @ApiProperty()
  isPublic!: boolean;

  @ApiPropertyOptional()
  updatedByUserId?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
