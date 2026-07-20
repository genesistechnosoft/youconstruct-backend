import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  TransactionReason,
  TransactionType,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class WalletTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionReason })
  @IsOptional()
  @IsEnum(TransactionReason)
  reason?: TransactionReason;
}
