import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ example: 'staff@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty()
  @IsUUID()
  customRoleId!: string;
}
