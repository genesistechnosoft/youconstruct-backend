import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { type Twilio } from 'twilio';
import type { SmsMessage, SmsSender } from './sms-sender.interface';

@Injectable()
export class TwilioSmsSender implements SmsSender {
  private readonly logger = new Logger(TwilioSmsSender.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;
  private readonly nodeEnv: string;

  constructor(private readonly config: ConfigService) {
    this.nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_FROM_NUMBER');

    if (accountSid && authToken && this.fromNumber) {
      this.client = twilio(accountSid, authToken);
    } else {
      this.client = null;
    }
  }

  async send(message: SmsMessage): Promise<void> {
    if (!this.client || !this.fromNumber) {
      if (this.nodeEnv === 'production') {
        throw new Error('SMS provider is not configured');
      }
      this.logger.warn(`SMS skipped (unconfigured) to=${message.to}`);
      return;
    }

    await this.client.messages.create({
      to: message.to,
      from: this.fromNumber,
      body: message.body,
    });
  }
}
