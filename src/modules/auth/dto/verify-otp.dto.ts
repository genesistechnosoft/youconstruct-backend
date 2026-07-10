import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;

  @ApiProperty({
    example: 'LOGIN',
    enum: ['LOGIN', 'REGISTER', 'RESET_PASSWORD'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['LOGIN', 'REGISTER', 'RESET_PASSWORD'])
  purpose: string;
}
