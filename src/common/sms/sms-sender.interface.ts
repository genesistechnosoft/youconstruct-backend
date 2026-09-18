export const SMS_SENDER = Symbol('SMS_SENDER');

export type SmsMessage = {
  to: string;
  body: string;
};

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}
