import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

export class ReplaceProductMediaDto {
  @ApiProperty({ example: 14 })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  thumbnailMediaId!: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  gallery!: string[];

  @ApiPropertyOptional({
    example: { 'a1b2c3d4-e5f6-7890-abcd-ef1234567890': [] },
  })
  @IsOptional()
  @IsObject()
  variants?: Record<string, string[]>;
}
