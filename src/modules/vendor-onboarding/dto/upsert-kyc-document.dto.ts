import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertKycDocumentDto {
  @ApiProperty({ example: 'https://cdn.example.com/kyc/pan.pdf' })
  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @IsString()
  documentNo?: string;
}
