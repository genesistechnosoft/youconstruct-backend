import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class RequestPayoutDto {
  @ApiProperty({ example: 500, minimum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  amount!: number;
}
