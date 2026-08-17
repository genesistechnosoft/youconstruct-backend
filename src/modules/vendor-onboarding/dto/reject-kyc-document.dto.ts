import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectKycDocumentDto {
  @ApiProperty({ example: 'Document image is blurry and unreadable.' })
  @IsString()
  @IsNotEmpty()
  rejectionNote!: string;
}
