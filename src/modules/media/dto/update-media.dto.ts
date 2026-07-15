import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateMediaDto {
  @ApiPropertyOptional({ example: 'Italian marble hero image' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fileName?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
