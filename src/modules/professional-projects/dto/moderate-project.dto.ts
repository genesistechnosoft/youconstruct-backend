import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectProjectDto {
  @ApiProperty({ example: 'Photos are low quality or misleading.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason!: string;
}

export class RemoveProjectDto {
  @ApiProperty({ example: 'Content violates platform guidelines.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  removalReason!: string;
}
