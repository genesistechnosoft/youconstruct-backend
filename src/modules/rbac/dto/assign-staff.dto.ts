import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PlatformRole } from '../../../../generated/prisma/client.js';

const STAFF_ROLES = [PlatformRole.ADMIN, PlatformRole.SUPPORT] as const;

export class AssignStaffDto {
  @ApiProperty({ example: 'cashier@youconstruct.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Cashier User' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({ enum: STAFF_ROLES })
  @IsEnum(STAFF_ROLES)
  platformRole!: (typeof STAFF_ROLES)[number];

  @ApiProperty()
  @IsUUID()
  customRoleId!: string;

}
