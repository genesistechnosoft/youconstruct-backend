import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateBankAccountDto {
  @ApiPropertyOptional({ example: 'Ramesh Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolderName?: string;

  // TODO: encrypt accountNumber at rest before production
  @ApiPropertyOptional({ example: '123456789012' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9,18}$/, {
    message: 'accountNumber must be 9-18 digits',
  })
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'HDFC0001234' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'ifscCode must be a valid IFSC code',
  })
  ifscCode?: string;

  @ApiPropertyOptional({ example: 'HDFC Bank' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'Navrangpura', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string | null;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIs...' })
  @IsString()
  @IsNotEmpty()
  stepUpToken!: string;
}
