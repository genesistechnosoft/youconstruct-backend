import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AdminListBankAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Omit or false for the unverified inbox. true lists already verified accounts.',
  })
  @IsOptional()
  @Transform(
    ({ obj }: { obj: Record<string, unknown> }) => obj.isVerified === 'true',
  )
  @IsBoolean()
  isVerified?: boolean = false;
}
