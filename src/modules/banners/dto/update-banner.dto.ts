import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

export class UpdateBannerDto extends PartialType(CreateBannerDto) {
  @ApiPropertyOptional({
    example: false,
    description:
      'true clears the web image when webImage is omitted. A new webImage replaces it instead. Omitted or false leaves the current web image.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  removeWebImage?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'true clears the app image when appImage is omitted. A new appImage replaces it instead. Omitted or false leaves the current app image.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  removeAppImage?: boolean;
}
