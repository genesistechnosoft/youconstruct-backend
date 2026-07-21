import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Short-lived JWT from OTP verify with purpose RESET_PASSWORD',
  })
  @IsString()
  @IsNotEmpty()
  passwordResetToken!: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
