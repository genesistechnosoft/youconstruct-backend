import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PayoutStatus } from '../../../../generated/prisma/client.js';
import { ListPayoutsQueryDto } from './list-payouts-query.dto';

export class AdminListPayoutsQueryDto extends ListPayoutsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  declare status?: PayoutStatus;
}
