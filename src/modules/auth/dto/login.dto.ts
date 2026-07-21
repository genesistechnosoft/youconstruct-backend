import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: 'john@example.com' })
  @ValidateIf((o: LoginDto) => o.email !== undefined && o.email !== null)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((o: LoginDto) => o.phone !== undefined && o.phone !== null)
  @IsPhoneNumber('IN')
  phone?: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
