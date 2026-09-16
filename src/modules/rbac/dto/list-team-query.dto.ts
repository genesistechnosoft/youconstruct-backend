import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  InvitationStatus,
  TeamMemberStatus,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum TeamMemberSortBy {
  CREATED_AT = 'createdAt',
  NAME = 'name',
}

export enum InvitationSortBy {
  CREATED_AT = 'createdAt',
  EXPIRES_AT = 'expiresAt',
}

export class ListTeamMembersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TeamMemberStatus })
  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;

  @ApiPropertyOptional({
    enum: TeamMemberSortBy,
    default: TeamMemberSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(TeamMemberSortBy)
  sortBy: TeamMemberSortBy = TeamMemberSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}

export class ListInvitationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: InvitationStatus,
    description:
      'PENDING excludes invitations past their expiry; EXPIRED includes them.',
  })
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;

  @ApiPropertyOptional({
    enum: InvitationSortBy,
    default: InvitationSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(InvitationSortBy)
  sortBy: InvitationSortBy = InvitationSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.DESC;
}
