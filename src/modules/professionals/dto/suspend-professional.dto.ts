import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuspendProfessionalDto {
  @ApiProperty({ example: 'Repeated violations of content policy.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  suspensionReason!: string;
}
