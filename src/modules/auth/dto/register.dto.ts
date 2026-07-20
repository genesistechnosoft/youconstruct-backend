import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PlatformRole } from '../../../../generated/prisma/client.js';

const REGISTERABLE_ROLES = [
  PlatformRole.CUSTOMER,
  PlatformRole.VENDOR,
  PlatformRole.PROFESSIONAL,
] as const;

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @ValidateIf((o: RegisterDto) => !o.phone)
  @IsNotEmpty({ message: 'Either email or phone must be provided' })
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((o: RegisterDto) => !o.email)
  @IsNotEmpty({ message: 'Either email or phone must be provided' })
  @IsPhoneNumber('IN')
  phone?: string;

  @ApiPropertyOptional({ example: 'password123', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    enum: REGISTERABLE_ROLES,
    default: PlatformRole.CUSTOMER,
  })
  @IsOptional()
  @IsIn(REGISTERABLE_ROLES)
  platformRole?: (typeof REGISTERABLE_ROLES)[number] = PlatformRole.CUSTOMER;
}
