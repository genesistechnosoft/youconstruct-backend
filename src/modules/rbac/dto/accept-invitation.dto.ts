import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Raw invitation token from email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description:
      'Display name for a new staff account (required for new users)',
  })
  @ValidateIf((o: AcceptInvitationDto) => !o.existingAccount)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Password for a new staff account (required for new users)',
    minLength: 12,
  })
  @ValidateIf((o: AcceptInvitationDto) => !o.existingAccount)
  @IsString()
  @MinLength(12)
  password?: string;

  /** Internal flag set by controller for logged-in accept flow */
  @IsOptional()
  existingAccount?: boolean;
}

export class AcceptExistingInvitationDto {
  @ApiProperty({ description: 'Raw invitation token from email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
