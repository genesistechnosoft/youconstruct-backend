import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpayOrderId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpayPaymentId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpaySignature!: string;
}
