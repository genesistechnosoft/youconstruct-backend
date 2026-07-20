import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'Ramesh Patel' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  accountHolderName!: string;

  // TODO: encrypt accountNumber at rest before production
  @ApiProperty({ example: '123456789012' })
  @IsString()
  @Matches(/^\d{9,18}$/, {
    message: 'accountNumber must be 9-18 digits',
  })
  accountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'ifscCode must be a valid IFSC code',
  })
  ifscCode!: string;

  @ApiProperty({ example: 'HDFC Bank' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  bankName!: string;

  @ApiPropertyOptional({ example: 'Navrangpura' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;
}
