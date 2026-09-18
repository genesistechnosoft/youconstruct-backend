import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { DOMAIN_ERROR_CODES } from '../errors/domain-error-code';
import { domainBadRequest } from '../errors/domain-exception';
import { SMS_SENDER, type SmsSender } from '../sms/sms-sender.interface';
import { CommerceOtpRepository } from './commerce-otp.repository';
import type { CommerceOtpPurpose } from './commerce-otp.constants';

@Injectable()
export class CommerceOtpService {
  constructor(
    private readonly otpRepository: CommerceOtpRepository,
    @Inject(SMS_SENDER) private readonly smsSender: SmsSender,
    private readonly config: ConfigService,
  ) {}

  async send(input: {
    phone: string;
    purpose: CommerceOtpPurpose;
    referenceType: string;
    referenceId: string;
    userId?: string;
    ttlMinutes: number;
    body: string;
  }) {
    const otp = randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60 * 1000);

    await this.otpRepository.invalidateUnverified({
      purpose: input.purpose,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

    await this.otpRepository.create({
      target: input.phone,
      otp: otpHash,
      purpose: input.purpose,
      expiresAt,
      userId: input.userId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

    await this.smsSender.send({
      to: input.phone,
      body: input.body.replace('{otp}', otp),
    });

    return {
      message: 'OTP sent successfully',
      data: this.shouldExpose() ? { otp } : null,
    };
  }

  async verify(input: {
    otp: string;
    purpose: CommerceOtpPurpose;
    referenceType: string;
    referenceId: string;
    maxAttempts: number;
  }) {
    const record = await this.otpRepository.findLatest({
      purpose: input.purpose,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

    if (!record) {
      throw domainBadRequest(DOMAIN_ERROR_CODES.OTP_INVALID, 'OTP not found');
    }

    if (record.expiresAt < new Date()) {
      throw domainBadRequest(DOMAIN_ERROR_CODES.OTP_EXPIRED, 'OTP has expired');
    }

    if (record.attempts >= input.maxAttempts) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.OTP_INVALID,
        'Too many OTP attempts',
      );
    }

    const isMatch = await bcrypt.compare(input.otp, record.otp);
    if (!isMatch) {
      await this.otpRepository.incrementAttempts(record.id);
      throw domainBadRequest(DOMAIN_ERROR_CODES.OTP_INVALID, 'Invalid OTP');
    }

    await this.otpRepository.markVerified(record.id);
    return true;
  }

  private shouldExpose() {
    const exposeOtp = this.config.get<string>('AUTH_EXPOSE_OTP_IN_RESPONSE');
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const flag = (exposeOtp ?? 'true').toLowerCase();
    return (
      nodeEnv !== 'production' &&
      flag !== 'false' &&
      flag !== '0' &&
      flag !== 'no'
    );
  }
}
