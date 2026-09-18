import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompletePayoutDto {
  @ApiProperty({ example: 'NEFT' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  payoutMethod!: string;

  @ApiProperty({ example: 'UTR1234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  referenceUtr!: string;

  @ApiPropertyOptional({ example: 'pout_ABC123' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  razorpayPayoutId?: string;
}
