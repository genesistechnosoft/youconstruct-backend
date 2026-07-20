import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompletePayoutDto {
  @ApiProperty({ example: 'pout_ABC123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  razorpayPayoutId!: string;
}
