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

/**
 * Email + password register only.
 * Phone signup must use OTP purpose REGISTER (not this endpoint).
 */
export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Not allowed on this endpoint — use OTP REGISTER instead',
  })
  @IsOptional()
  @ValidateIf((o: RegisterDto) => o.phone !== undefined && o.phone !== null)
  @IsPhoneNumber('IN')
  phone?: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    enum: REGISTERABLE_ROLES,
    default: PlatformRole.CUSTOMER,
  })
  @IsOptional()
  @IsIn(REGISTERABLE_ROLES)
  platformRole?: (typeof REGISTERABLE_ROLES)[number] = PlatformRole.CUSTOMER;
}
