import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubOrderStatus } from '../../../../generated/prisma/client.js';

export class UpdateSubOrderStatusDto {
  @ApiProperty({ enum: SubOrderStatus })
  @IsEnum(SubOrderStatus)
  status!: SubOrderStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
