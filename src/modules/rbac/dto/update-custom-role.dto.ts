import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateCustomRoleDto {
  @ApiPropertyOptional({ example: 'Warehouse Staff' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['products:view', 'inventory:manage'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];
}
