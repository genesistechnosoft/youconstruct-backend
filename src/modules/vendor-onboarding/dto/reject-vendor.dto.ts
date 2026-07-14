import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectVendorDto {
  @ApiProperty({ example: 'GST certificate is not readable.' })
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}
