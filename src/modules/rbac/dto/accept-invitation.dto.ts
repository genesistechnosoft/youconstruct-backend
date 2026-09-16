import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Raw invitation token from email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description: 'Display name — required when creating a new staff account',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Password — required when creating a new staff account',
    minLength: 12,
  })
  @IsOptional()
  @IsString()
  @MinLength(12)
  password?: string;
}

export class PreviewInvitationDto {
  @ApiProperty({ description: 'Raw invitation token from the email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
