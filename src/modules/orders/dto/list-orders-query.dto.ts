import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  FulfillmentStage,
  SubOrderStatus,
} from '../../../../generated/prisma/client.js';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FulfillmentStage,
    description: 'Filters the shipment-derived fulfillment stage',
  })
  @IsOptional()
  @IsEnum(FulfillmentStage)
  status?: FulfillmentStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListSubOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubOrderStatus })
  @IsOptional()
  @IsEnum(SubOrderStatus)
  status?: SubOrderStatus;

  @ApiPropertyOptional({ enum: FulfillmentStage })
  @IsOptional()
  @IsEnum(FulfillmentStage)
  fulfillmentStage?: FulfillmentStage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
