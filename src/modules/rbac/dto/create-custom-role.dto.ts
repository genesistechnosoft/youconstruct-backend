import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString, IsNotEmpty } from 'class-validator';

export class CreateCustomRoleDto {
  @ApiProperty({ example: 'Store Manager' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    type: [String],
    example: ['products:create', 'products:edit', 'media:upload'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionKeys!: string[];
}
