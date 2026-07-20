import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TeamMemberStatus } from '../../../../generated/prisma/client.js';

export class UpdateTeamMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customRoleId?: string;

  @ApiPropertyOptional({ enum: TeamMemberStatus })
  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;
}
