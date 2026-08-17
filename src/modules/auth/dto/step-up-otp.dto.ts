import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

export const STEP_UP_PURPOSE_VALUES = [
  'BANK_ACCOUNT_CHANGE',
  'PAYOUT_REQUEST',
] as const;

export type StepUpPurposeDto = (typeof STEP_UP_PURPOSE_VALUES)[number];

export class SendStepUpOtpDto {
  @ApiProperty({ enum: STEP_UP_PURPOSE_VALUES })
  @IsIn(STEP_UP_PURPOSE_VALUES)
  purpose!: StepUpPurposeDto;
}

export class VerifyStepUpOtpDto extends SendStepUpOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}
