import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectProductDto {
  @ApiProperty({ example: 'Product images are unclear.' })
  @IsString()
  @IsNotEmpty()
  rejectionNote!: string;
}
