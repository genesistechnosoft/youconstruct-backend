import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChangeProductSlugDto {
  @ApiProperty({ example: 'flow-check-cement-bag' })
  @IsString()
  @IsNotEmpty()
  slug!: string;
}
