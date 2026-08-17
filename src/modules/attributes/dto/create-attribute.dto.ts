import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAttributeDto {
  @ApiProperty({ example: 'Thickness' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'mm' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;
}
