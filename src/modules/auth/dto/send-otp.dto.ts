import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsPhoneNumber, IsString } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsPhoneNumber('IN')
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: 'LOGIN',
    enum: ['LOGIN', 'REGISTER', 'RESET_PASSWORD'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['LOGIN', 'REGISTER', 'RESET_PASSWORD'])
  purpose: string;
}
