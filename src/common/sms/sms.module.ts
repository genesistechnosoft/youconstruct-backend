import { Global, Module } from '@nestjs/common';
import { SMS_SENDER } from './sms-sender.interface';
import { TwilioSmsSender } from './twilio-sms.sender';

@Global()
@Module({
  providers: [
    TwilioSmsSender,
    {
      provide: SMS_SENDER,
      useExisting: TwilioSmsSender,
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
