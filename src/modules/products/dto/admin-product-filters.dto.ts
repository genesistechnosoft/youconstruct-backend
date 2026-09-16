import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ProductFiltersDto } from './product-filters.dto';

export class AdminProductFiltersDto extends ProductFiltersDto {
  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}
