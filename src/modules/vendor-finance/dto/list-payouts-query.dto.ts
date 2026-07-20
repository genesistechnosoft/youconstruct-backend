import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PayoutStatus } from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListPayoutsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;
}
