import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FailPayoutDto {
  @ApiProperty({ example: 'Bank transfer rejected by provider' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  failureReason!: string;
}
